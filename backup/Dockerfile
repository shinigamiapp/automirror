FROM alpine:3.21

RUN apk add --no-cache rclone bash tzdata curl gnupg \
  && curl -Ls --tlsv1.2 --proto "=https" --retry 3 https://cli.doppler.com/install.sh | sh \
  && apk del curl gnupg

WORKDIR /app

COPY entrypoint.sh ./entrypoint.sh
COPY sync.sh ./sync.sh

RUN chmod +x ./entrypoint.sh ./sync.sh

ENTRYPOINT ["doppler", "run", "--", "/app/entrypoint.sh"]
