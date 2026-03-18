#!/usr/bin/env bash
set -euo pipefail

: "${R2_ACCOUNT_ID:?R2_ACCOUNT_ID is required}"
: "${R2_ACCESS_KEY_ID:?R2_ACCESS_KEY_ID is required}"
: "${R2_SECRET_ACCESS_KEY:?R2_SECRET_ACCESS_KEY is required}"
: "${BACKUP_R2_BUCKET_NAME:?BACKUP_R2_BUCKET_NAME is required}"

# Write rclone config from env vars
mkdir -p /root/.config/rclone
cat > /root/.config/rclone/rclone.conf << EOF
[r2]
type = s3
provider = Cloudflare
access_key_id = ${R2_ACCESS_KEY_ID}
secret_access_key = ${R2_SECRET_ACCESS_KEY}
endpoint = https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com
acl = private
no_check_bucket = true
EOF

# Persist env vars for cron (cron doesn't inherit Doppler-injected env)
env | grep -E '^(BACKUP_|R2_|RCLONE_|PATH=)' | sed 's/^/export /' > /app/.env.cron

# Register cron: sync runs every hour at :10 (10 min after backup)
echo "10 * * * * . /app/.env.cron; /app/sync.sh >> /proc/1/fd/1 2>&1" | crontab -

echo "[$(date -u)] DB sync service ready. Hourly sync scheduled at :10 past every hour."

# Keep container alive with cron daemon
exec crond -f -l 8
