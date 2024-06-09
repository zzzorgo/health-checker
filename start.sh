docker run -it -d \
    --network=host \
    --env HEALTH_CHECKER_BOT_TOKEN=${HEALTH_CHECKER_BOT_TOKEN} \
    --env HEALTH_CHECKER_CHAT_ID=${HEALTH_CHECKER_CHAT_ID} \
    dselianin/health-checker:latest entrypoint.sh
