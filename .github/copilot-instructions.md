# Automirror — Project Guidelines

Automirror is a **manga auto-sync orchestration service**: it periodically scans manga sources for new chapters, downloads and packages chapter images, uploads ZIPs to B2 cloud storage, registers them with the backend API, and publishes realtime updates via Ably. It runs as a Fastify HTTP server on port 3000 with two background workers.

## Build & Test

```bash
npm run dev          # tsx watch (hot reload)
npm run build        # tsc → dist/
npm start            # node dist/index.js (production)
npm run typecheck    # tsc --noEmit
npm test             # Vitest
npm run test:watch
```

**Docker (production):** `doppler run -- node dist/index.js` — all Doppler-managed secrets are injected at container startup. See [docs/doppler-secrets-runbook.md](../docs/doppler-secrets-runbook.md) for startup commands and troubleshooting.

**Standalone DB migration:** `npx tsx src/db/migrate.ts`

## Architecture

```
Fastify (port 3000)
 ├─ Routes:   src/routes/manga.ts · realtime.ts · webhooks.ts
 ├─ Workers:  src/workers/scanner.ts    — detect new chapters (every 60 s)
 │            src/workers/sync-processor.ts — 4-step sync pipeline (every 10 s)
 └─ Services: scraper.ts · backend.ts · uploader.ts · realtime.ts · cache.ts
```

**Sync pipeline (sync-processor):** scrape images → create ZIP (via scraper API) → upload to B2 → register in backend API. Each step maps to a task status: `pending → scraping → scraped → uploading → uploaded → completed`.

**Scanner optimization:** metadata-only check first; full chapter list fetch only when new chapters are detected.

**Scraper load balancing:** round-robin across `SCRAPER_HOSTS` with per-host failure tracking and 60 s cooldown.

## Conventions

**Naming:**
- `src/db/repositories/*.ts` — database query functions, exported as `*Repo`
- `src/services/*.ts` — external API clients, referenced as `*Service`
- `src/schemas/*.ts` — Zod schemas, named `*Schema`
- Workers use `src/workers/scheduler.ts` to prevent overlapping executions

**Validation:** All route input/output defined with Zod schemas in `src/schemas/`. Pass schemas to Fastify's `schema` option.

**Error handling:** Workers catch errors per-task, increment retry count, and transition to `'failed'` after `MAX_TASK_RETRIES` (3). Server never crashes on task failure. Use the circuit breaker (`src/utils/circuit-breaker.ts`) for external service calls.

**HTTP client:** use `src/utils/fetch.ts` (timeout-aware) rather than raw `fetch`.

**Logging:** Pino via Fastify's built-in `request.log`. Use structured log objects, not string interpolation.

## Environment Variables

**Local (`.env`):** `PORT`, `HOST`, `NODE_ENV`, `LOG_LEVEL`, `MYSQL_*`

**Doppler-managed secrets** (never in `.env`): `SCRAPER_*`, `UPLOADER_*`, `BACKEND_API_*`, `ADMIN_API_KEY`, `ABLY_*`, `NOVU_*`, `CACHE_PURGE_*`. See `src/config.ts` for the full list.

> In Docker Compose `command` blocks, use `$${VAR}` (double-dollar) if the value must survive Docker Compose's variable interpolation.

## Key Files

| File | Role |
|------|------|
| `src/config.ts` | All env var definitions and defaults |
| `src/types.ts` | Shared TypeScript types (task status enums, etc.) |
| `src/db/migrations/001_initial.ts` | DB schema reference |
| `src/db/repositories/manga.ts` | All SQL queries |
| `upstream_docs/` | Contracts for scraper, uploader, and backend APIs |
| `docs/realtime-contract.md` | Ably channel naming and token scopes |
