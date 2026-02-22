# Scraper Pipeline Worker - AI Instructions

## Project Overview

Cloudflare Worker orchestrating a two-stage manga processing pipeline:
1. **Scrape** → Call external Scraper API to create ZIP on R2
2. **Upload** → Pass ZIP URL to Uploader API to publish chapters

The worker **never handles files** — only passes URLs between services and tracks state in D1.

## Architecture

```
Admin Panel → Worker REST API → D1 Database (state machine)
                              ↓
                    Cron (every 30s) polls external APIs
                              ↓
                    Scraper API ←→ Uploader API
```

## State Machine (Critical)

Jobs progress through these statuses in order:
```
pending → scrape_polling → scrape_completed → upload_polling → completed
                                                             ↘ failed
```

- `scrape_completed` is an intermediate state when upload slots are full
- Each status transition happens in the cron handler, not REST endpoints
- REST endpoints only create jobs (`pending`) or retry failed jobs

## Project Structure

```
src/
├── index.ts      # Entry: fetch handler (router) + scheduled handler (cron)
├── router.ts     # REST API route handlers
├── cron.ts       # Cron job processing logic (state transitions)
├── db.ts         # D1 queries and schema migration
├── types.ts      # Env, PipelineJob interfaces
├── config.ts     # Constants: MAX_CONCURRENT_SCRAPE=3, MAX_CONCURRENT_UPLOAD=3
└── utils.ts      # extractMangaIdFromUrl, json responses, auth middleware
```

## Key Patterns

### Concurrency Control
- Query `COUNT(*) WHERE status = 'scrape_polling'` before promoting pending jobs
- Same for uploads — independent slot pools (3 scrape + 3 upload concurrent)
- Always order by `priority DESC, created_at ASC`

### Overlap Guard
All polling queries must include:
```sql
WHERE updated_at < datetime('now', '-20 seconds')
```
Prevents double-processing when cron ticks overlap.

### Error Handling
- Transient errors (5xx, fetch fail) → increment `poll_error_count`, retry next tick
- 10 consecutive poll errors → mark job `failed`
- API returns `failed` status → immediate fail with stored error
- 404 on status poll → job expired, mark failed

### Smart Retry Logic
When retrying a failed job:
- If `zip_url` exists → reset to `scrape_completed` (skip re-scraping)
- If `zip_url` is NULL → reset to `pending` (full restart)

## External API Contracts

### Scraper API
```typescript
// Start: POST {SCRAPER_BASE_URL}/manga/batch-download
{ mangaUrl, startChapter, endChapter, mangaId, async: true }
// Response: { success, data: { jobId } }

// Poll: GET .../status/{jobId}
// Response: { data: { status, progress, result?: { publicUrl }, error? } }
```

### Uploader API
```typescript
// Start: POST {UPLOADER_BASE_URL}/v1/upload/job
// Headers: { "X-API-KEY": env.UPLOADER_API_KEY }
{ zip_url, manga_id, series_title, default_release_date? }
// Response: { job_id }

// Poll: GET .../job/{jobId}
// Response: { status, progress, results?, error? }
```

## Environment Bindings

```typescript
interface Env {
  DB: D1Database;
  SCRAPER_BASE_URL: string;
  UPLOADER_BASE_URL: string;
  UPLOADER_API_KEY: string;  // secret
  ADMIN_API_KEY: string;     // secret
}
```

## Conventions

- All REST endpoints (except `/health`) require `X-API-Key` header
- Job IDs are UUIDv4, generated server-side
- Progress fields (`scrape_progress`, `upload_progress`) are stored as JSON strings in D1
- `progress_pct` and `progress_message` are computed on read, not stored
- ISO 8601 datetime strings throughout

## Commands

```bash
wrangler d1 create scraper-pipeline        # Create D1 database
wrangler d1 execute scraper-pipeline --file=schema.sql  # Run migrations
wrangler secret put ADMIN_API_KEY          # Set secrets
wrangler secret put UPLOADER_API_KEY
wrangler dev                               # Local development
wrangler deploy                            # Production deploy
```

## Implementation Reference

See [SCRAPER-PIPELINE-WORKER-PLAN.md](../SCRAPER-PIPELINE-WORKER-PLAN.md) for complete specification including:
- Full D1 schema with indexes
- Detailed cron handler pseudocode
- All REST endpoint request/response shapes
- Error handling matrix
