import fs from 'node:fs';
import path from 'node:path';
import { createEffect, createEvent, createStore, sample } from 'npm:effector';
import {combineEvents} from 'npm:patronum';

type Target = {
    url: string;
    pollInterval: number;
    message: string;
    checkTimeout: number;
}

type Config = {
    targets: Target[],
    botToken: string;
    chatId: number;
};

const configRaw = fs.readFileSync(path.resolve(import.meta.dirname ?? '', 'config.json')).toString();
const config: Config = JSON.parse(configRaw);

const sendTelegramMessage = async (text: string) => {
    return fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({ chat_id: config.chatId, text }),
    });
}

const createHealthChecker = (target: Target) => {
    const exceptionEvent = createEvent();
    const healthyResponseEvent = createEvent();
    const resetHealthRestoredEvent = createEvent();

    const reportError = async (error: Error) => {
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
        let timeout = 0;
        const timeoutPromise: Promise<Response> = new Promise((_, reject) => {
            timeout = setTimeout(() => {
                reject();
            }, target.checkTimeout);
        });

        const fetchPromise = fetch(target.url);

        Promise.race([fetchPromise, timeoutPromise])
            .then((response) => {
                clearTimeout(timeout);
                if (!response.ok) {
                    exceptionEvent();
                } else {
                    healthyResponseEvent();
                }
            }).catch(() => {
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
        fn: () => new Error(target.message),
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

    setInterval(() => checkHealth(), target.pollInterval);
};

const run = () => {
    config.targets.forEach((target) => {
        createHealthChecker(target);
    });
};

run();
