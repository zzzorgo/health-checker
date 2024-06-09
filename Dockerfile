FROM denoland/deno:alpine

RUN apk add envsubst
WORKDIR /app
COPY . .

