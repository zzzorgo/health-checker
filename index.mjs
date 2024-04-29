const config = {
    targets: [{
        url: 'http://localhost:64115',
        pollInterval: 2000,
        message: 'There are problems with home server connectivity. Check wi-fi connection.',
        repeatInterval: 3600_000,
    }],
};

const health = {};
const botToken = '';
const chatId = -4147694286;

const reportError = async (url, e, repeatInterval) => {
    if (!health[url]) {
        health[url] = true;
        console.error(e);
        await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({chat_id: chatId, text: e.message}),
        })

        setTimeout(() => {
            health[url] = undefined;
            reportError(url, e, repeatInterval);
            health[url] = true;
        }, repeatInterval);
    }
};

const run = () => {
    config.targets.forEach((target) => {
        setInterval(() => {

            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => {
                    reject(new Error(`Request timed out: ${target.message}`));
                }, 5000);
            });

            const fetchPromise = fetch(target.url);

            Promise.race([fetchPromise, timeoutPromise])
                .then(response => {
                    if (!response.ok) {
                        reportError(target.url, new Error(`Response: ${response.status} ${response.statusText}. ${target.message}`), target.repeatInterval)
                    } else {
                        health[target.url] = undefined;
                    }
                }).catch((e) => {
                    reportError(target.url, new Error(`${target.message} (${e.message})`), target.repeatInterval);
                });
        }, target.pollInterval);
    });

};

run();
