# Automirror Secret Ownership Runbook

## Local `.env` ownership
Keep only local infra/runtime variables in `.env`:
- `DOPPLER_TOKEN`
- `VIRTUAL_HOST`, `LETSENCRYPT_HOST`
- `MYSQL_HOST`, `MYSQL_PORT`, `MYSQL_DATABASE`, `MYSQL_USER`, `MYSQL_PASSWORD`
- Optional non-secret toggles: `LOG_LEVEL`, `ABLY_CHANNEL_PREFIX`
- Backup knobs: `BACKUP_INTERVAL_SECONDS`, `BACKUP_RETENTION`, `SYNC_INTERVAL_SECONDS`, `BACKUP_R2_PATH`

## Doppler ownership
Store app and integration secrets in Doppler, including:
- Core app config: `SCRAPER_BASE_URL`, `SCRAPER_HOSTS`, `SCRAPER_STRATEGY`, `SCRAPER_HOST_TIMEOUT_MS`, `SCRAPER_HOST_MAX_FAILURES`
- External APIs: `UPLOADER_BASE_URL`, `BACKEND_API_URL`, `CACHE_PURGE_URL`, `API_URL`, `DASHBOARD_URL`, `DEFAULT_THUMBNAIL_URL`
- API keys and notifications: `ADMIN_API_KEY`, `UPLOADER_API_KEY`, `BACKEND_API_KEY`, `CACHE_PURGE_API_KEY`, `NOVU_API_KEY`, `NOVU_SUBSCRIBER_ID`
- Realtime: `ABLY_API_KEY`
- Backup sync (R2): `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_BUCKET`, optional `R2_ENDPOINT`

## Operations
- Render config: `doppler run -- docker compose config`
- Start stack: `bash scripts/start.sh`
- Confirm scraper health: `docker compose ps` and `docker compose logs scraper-worker`
- Confirm backups and sync: `docker compose logs db-backup db-sync`
