#!/bin/sh

envsubst < "config.json.envsubst" > "config.json"

deno run --allow-net --allow-read index.ts
