#!/usr/bin/env sh
set -eu

if [ -z "${DOPPLER_TOKEN:-}" ] && [ -f ./.env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi

if [ -z "${DOPPLER_TOKEN:-}" ]; then
  echo "Error: DOPPLER_TOKEN is not set."
  echo "Set it in environment or /root/services/automirror/.env before starting."
  exit 1
fi

exec doppler run -- docker compose up -d --build "$@"
