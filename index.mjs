import fs from 'fs';
import path from 'path';
import {createEffect, createEvent, createStore, sample} from 'effector';

const configRaw = fs.readFileSync(path.resolve(import.meta.dirname, 'config.json')).toString();
const config = JSON.parse(configRaw);

const exceptionEvent = createEvent();
const healthyResponseEvent = createEvent();
const healthyResponseReportedEvent = createEvent();
const exceptionReportedEvent = createEvent();

const reportError = async ({url, error}) => {
    console.log('reportError');
    console.error(error);
    // exceptionReportedEvent(url);

    // setTimeout(() => {
    //     healthyResponseEvent(url);
    // }, 5000);
    const response = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({chat_id: config.chatId, text: `URL: ${url}, ${error.message}`}),
    });

    if (response.ok) {
        exceptionReportedEvent(url);
    }
};

const reportHealthy = async (url) => {
    console.log('reportHealthy');
   const response = await fetch(`https://api.telegram.org/bot${config.botToken}/sendMessage`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify({chat_id: config.chatId, text: `URL: ${url} is now healthy`}),
    });

    if (response.ok) {
        healthyResponseReportedEvent(url);
    }
};

const $targetExceptionCount = createStore(new Map())
    .on(exceptionEvent, (state, event) => {
        const prevCount = state.get(event) ?? 0;
        state.set(event, prevCount + 1);

        return state;
    })
    .on(healthyResponseEvent, (state, event) => {
        state.set(event, 0);

        return state;
    });

const $targetReportStatus = createStore(new Map())
    .on(exceptionEvent, (state, event) => {
        if (state.get(event) !== 'error-reported') {
            state.set(event, 'error');
        }

        return state;
    })
    .on(exceptionReportedEvent, (state, event) => {
        state.set(event, 'error-reported');

        return state;
    })
    .on(healthyResponseEvent, (state, event) => {
        if (state.get(event) !== 'healthy-reported') {
            state.set(event, 'healthy');
        }

        return state;
    })
    .on(healthyResponseReportedEvent, (state, event) => {
        state.set(event, 'healthy-reported');

        return state;
    });

const checkHealth = (target) => {
    console.log('checkHealth');
    let timeout = null;
    const timeoutPromise = new Promise((_, reject) => {
        timeout = setTimeout(() => {
            reject();
        }, 5000);
    });

    const fetchPromise = fetch(target.url);

    Promise.race([fetchPromise, timeoutPromise])
        .then(response => {
            clearTimeout(timeout);
            if (!response.ok) {
                exceptionEvent(target.url);
            } else {
                healthyResponseEvent(target.url);
            }
        }).catch((e) => {
            exceptionEvent(target.url);
        });
}

const checkHealthEffect = createEffect(checkHealth);
const reportErrorEffect = createEffect(reportError);
const reportHealthyEffect = createEffect(reportHealthy);

const getTarget = (targetUrl) => config.targets.find((target) => targetUrl === target.url);

sample({
    source: {counter: $targetExceptionCount, statuses: $targetReportStatus},
    clock: exceptionEvent,
    filter: ({counter, statuses}, targetUrl) => counter.get(targetUrl) < 3 && statuses.get(targetUrl) !== 'error-reported',
    fn: (_, targetUrl) => getTarget(targetUrl),
    target: checkHealthEffect,
});

sample({
    source: {counter: $targetExceptionCount, statuses: $targetReportStatus},
    clock: exceptionEvent,
    filter: ({counter, statuses}, targetUrl) => counter.get(targetUrl) >= 3 && statuses.get(targetUrl) === 'error',
    fn: (_, targetUrl) => ({url: targetUrl, error: new Error(getTarget(targetUrl).message)}),
    target: reportErrorEffect,
});

sample({
    source: {counter: $targetExceptionCount, statuses: $targetReportStatus},
    clock: healthyResponseEvent,
    filter: ({counter, statuses}, targetUrl) => statuses.get(targetUrl) !== 'healthy-reported',
    fn: (_, targetUrl) => targetUrl,
    target: reportHealthyEffect,
});

const run = () => {
    config.targets.forEach((target) => {
        setInterval(() => checkHealth(target), target.pollInterval);
    });
};

run();
