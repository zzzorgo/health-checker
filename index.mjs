import fs from 'fs';
import path from 'path';
import { createEffect, createEvent, createStore, sample } from 'effector';
import {combineEvents} from 'patronum';

const configRaw = fs.readFileSync(path.resolve(import.meta.dirname, 'config.json')).toString();
const config = JSON.parse(configRaw);

const sendTelegramMessage = async (text) => {
    return fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ chat_id: config.chatId, text }),
    });
}

const createHealthChecker = (target) => {
    const exceptionEvent = createEvent();
    const healthyResponseEvent = createEvent();
    const resetHealthRestoredEvent = createEvent();

    const reportError = async ({ error }) => {
        console.log(`reportError ${target.url}`);
        console.error(error);

        const response = await sendTelegramMessage(`URL: ${target.url}, ${error.message}`);

        if (!response.ok) {
            throw new Error('reporting failed');
        }
    };

    const reportHealthy = async () => {
        console.log(`reportHealthy ${target.url}`);
        await sendTelegramMessage(`URL: ${target.url} is now healthy`);
    };

    const checkHealth = () => {
        console.log(`checkHealth ${target.url}`);
        let timeout = null;
        const timeoutPromise = new Promise((_, reject) => {
            timeout = setTimeout(() => {
                reject();
            }, target.checkTimeout);
        });

        const fetchPromise = fetch(target.url);

        Promise.race([fetchPromise, timeoutPromise])
            .then(response => {
                clearTimeout(timeout);
                if (!response.ok) {
                    exceptionEvent();
                } else {
                    healthyResponseEvent();
                }
            }).catch((e) => {
                exceptionEvent();
            });
    }

    const retryCheckHealthEffect = createEffect(checkHealth);
    const reportErrorEffect = createEffect(reportError);
    const reportHealthyEffect = createEffect(reportHealthy);
    const healthRestoredEvent = combineEvents({
        events: [reportErrorEffect.done, healthyResponseEvent],
        reset: resetHealthRestoredEvent,
    });

    const $targetExceptionCount = createStore(0)
        .on(exceptionEvent, (state) => state + 1)
        .on(healthyResponseEvent, () => 0);

    const $targetReportStatus = createStore('initial')
        .on(exceptionEvent, (state) => state === 'error-reported' ? state : 'error')
        .on(reportErrorEffect.done, () => 'error-reported')
        .on(healthyResponseEvent, () => 'healthy');

    sample({
        source: $targetExceptionCount,
        clock: exceptionEvent,
        filter: counter => counter < 3,
        target: retryCheckHealthEffect,
    });

    sample({
        source: { counter: $targetExceptionCount, status: $targetReportStatus },
        clock: exceptionEvent,
        filter: ({ counter, status }) => counter >= 3 && status !== 'error-reported',
        fn: () => ({ error: new Error(target.message) }),
        target: reportErrorEffect,
    });

    sample({
        source: $targetReportStatus,
        clock: exceptionEvent,
        filter: (status) => status !== 'error-reported',
        target: resetHealthRestoredEvent,
    });

    sample({
        clock: healthRestoredEvent,
        target: reportHealthyEffect,
    });

    setInterval(() => checkHealth(target), target.pollInterval);
};

const run = () => {
    config.targets.forEach((target) => {
        createHealthChecker(target);
    });
};

run();
