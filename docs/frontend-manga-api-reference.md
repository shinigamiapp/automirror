# Frontend API Reference (React) — Manga + Health

This doc covers only:
- `/manga` endpoints (CRUD + actions)
- `/health` endpoint (optional app health check)

## Base URL

- Local: `http://localhost:3000` (or your configured `PORT`)
- API docs UI: `GET /reference`

## Auth

- Current implementation does **not** enforce request auth in route handlers.
- If you later add auth middleware, send `X-API-Key` from frontend env.

Example:

```ts
const headers: HeadersInit = {
  'Content-Type': 'application/json',
  // 'X-API-Key': import.meta.env.VITE_ADMIN_API_KEY,
};
```

---

## Shared Response Patterns

Success responses use:

```ts
{ success: true, data: ... }
```

Error responses use:

```ts
{ success: false, error: string }
```

Some action endpoints return:

```ts
{ success: true, message: string, data: ... }
```

---

## Types for React Frontend

```ts
export type MangaStatus = 'idle' | 'scanning' | 'syncing' | 'error';

export interface Manga {
  id: string;
  manga_id: string;
  manga_url: string;
  source_domain: string;
  manga_slug: string;
  series_title: string;
  status: MangaStatus;
  auto_sync_enabled: boolean;
  check_interval_minutes: number;
  priority: number;
  source_chapter_count: number;
  source_last_chapter: number | null;
  backend_chapter_count: number;
  backend_last_chapter: number | null;
  sync_progress: {
    total: number;
    completed: number;
    failed: number;
  };
  last_scanned_at: string | null;
  last_synced_at: string | null;
  next_scan_at: string | null;
  last_error: string | null;
  consecutive_failures: number;
  created_at: string;
  updated_at: string;
}

export interface FailedTask {
  id: string;
  chapter_number: number;
  chapter_url: string;
  error: string | null;
  retry_count: number;
}

export interface MangaDetail extends Manga {
  last_error_at: string | null;
  failed_tasks: FailedTask[];
}
```

---

## `/manga` Endpoints

### 1) List manga

`GET /manga?page=1&page_size=20&sort=created_at`

Query params:
- `page` (number, min 1, default `1`)
- `page_size` (number, min 1, max 100, default `20`)
- `sort` (`created_at | updated_at | series_title | priority`)

`200`:

```json
{
  "success": true,
  "data": {
    "manga": [],
    "total": 0,
    "page": 1,
    "page_size": 20
  }
}
```

---

### 2) Get manga detail

`GET /manga/:id`

- `id` must be UUID.

`200`: `{ success: true, data: MangaDetail }`

`404`:

```json
{ "success": false, "error": "Manga not found" }
```

---

### 3) Create manga registry entry

`POST /manga`

Body:

```ts
{
  manga_url: string;           // valid URL
  manga_id: string;            // UUID
  series_title: string;
  source_domain: string;
  manga_slug: string;
  auto_sync_enabled?: boolean; // default true
  check_interval_minutes?: number; // default 360
  priority?: number;           // default 0
}
```

`201`: `{ success: true, data: Manga }`

`409` (duplicate `manga_id`):

```json
{ "success": false, "error": "Manga with this manga_id is already registered" }
```

---

### 4) Update manga settings

`PATCH /manga/:id`

- Partial body of the create schema.
- `id` must be UUID.

`200`: `{ success: true, data: Manga }`

`404`: `{ success: false, error: "Manga not found" }`

---

### 5) Delete manga

`DELETE /manga/:id`

`200`:

```json
{ "success": true, "message": "Manga removed from registry" }
```

`404`: `{ success: false, error: "Manga not found" }`

---

### 6) Force scan

`POST /manga/:id/force-scan`

`202`:

```json
{
  "success": true,
  "message": "Force scan scheduled",
  "data": { "status": "idle" }
}
```

`404`: manga not found  
`409`: already scanning/syncing

---

### 7) Retry failed sync tasks

`POST /manga/:id/retry`

Rules:
- Manga status must be `error`
- There must be at least 1 failed task

`200`:

```json
{
  "success": true,
  "message": "Retrying 3 failed task(s)",
  "data": { "retrying": 3, "status": "syncing" }
}
```

`400`:
- `Only manga with status "error" can be retried`
- `No failed tasks found to retry`

`404`: manga not found

---

## Optional `/health` Endpoint

`GET /health`

- Use for dashboard status indicator or startup connectivity check.
- Returns `200` when healthy, `503` when degraded.

Response shape:

```ts
{
  status: 'healthy' | 'degraded';
  timestamp: string;
  uptime: number;
  checks: {
    database: { ok: boolean; error?: string };
    scraper: { ok: boolean; latencyMs: number; error?: string };
    uploader: { ok: boolean; latencyMs: number; error?: string };
    backend: { ok: boolean; latencyMs: number; error?: string };
  };
  workers: Array<{ name: string; running: boolean; shuttingDown: boolean }>;
  circuits: { scraper: string; uploader: string; backend: string };
  queues: {
    pending_tasks: number;
    syncing_manga: number;
    failed_tasks: number;
    scanning_manga: number;
  };
}
```

---

## React Implementation Example

### API Client (`src/api/manga.ts`)

```ts
const API_BASE = import.meta.env.VITE_API_BASE_URL;

async function http<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });

  const json = await res.json();
  if (!res.ok || json?.success === false) {
    throw new Error(json?.error ?? `HTTP ${res.status}`);
  }
  return json as T;
}

export const mangaApi = {
  list: (params: { page?: number; page_size?: number; sort?: 'created_at' | 'updated_at' | 'series_title' | 'priority' } = {}) => {
    const search = new URLSearchParams();
    if (params.page) search.set('page', String(params.page));
    if (params.page_size) search.set('page_size', String(params.page_size));
    if (params.sort) search.set('sort', params.sort);
    return http<{ success: true; data: { manga: Manga[]; total: number; page: number; page_size: number } }>(`/manga?${search.toString()}`);
  },

  getById: (id: string) =>
    http<{ success: true; data: MangaDetail }>(`/manga/${id}`),

  create: (payload: {
    manga_url: string;
    manga_id: string;
    series_title: string;
    source_domain: string;
    manga_slug: string;
    auto_sync_enabled?: boolean;
    check_interval_minutes?: number;
    priority?: number;
  }) => http<{ success: true; data: Manga }>(`/manga`, { method: 'POST', body: JSON.stringify(payload) }),

  update: (id: string, payload: Partial<{
    manga_url: string;
    manga_id: string;
    series_title: string;
    source_domain: string;
    manga_slug: string;
    auto_sync_enabled: boolean;
    check_interval_minutes: number;
    priority: number;
  }>) => http<{ success: true; data: Manga }>(`/manga/${id}`, { method: 'PATCH', body: JSON.stringify(payload) }),

  remove: (id: string) =>
    http<{ success: true; message: string }>(`/manga/${id}`, { method: 'DELETE' }),

  forceScan: (id: string) =>
    http<{ success: true; message: string; data: { status: string } }>(`/manga/${id}/force-scan`, { method: 'POST' }),

  retry: (id: string) =>
    http<{ success: true; message: string; data: { retrying: number; status: string } }>(`/manga/${id}/retry`, { method: 'POST' }),

  health: () =>
    http<{
      status: 'healthy' | 'degraded';
      timestamp: string;
      uptime: number;
    }>(`/health`),
};
```

### React Query usage

```ts
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

export function useMangaList(page: number, pageSize: number, sort?: 'created_at' | 'updated_at' | 'series_title' | 'priority') {
  return useQuery({
    queryKey: ['manga', page, pageSize, sort],
    queryFn: () => mangaApi.list({ page, page_size: pageSize, sort }),
    select: (res) => res.data,
  });
}

export function useMangaDetail(id: string) {
  return useQuery({
    queryKey: ['manga-detail', id],
    queryFn: () => mangaApi.getById(id),
    select: (res) => res.data,
    refetchInterval: (query) => {
      const status = query.state.data?.data?.status;
      return status === 'scanning' || status === 'syncing' ? 5000 : false;
    },
  });
}

export function useForceScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => mangaApi.forceScan(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['manga'] }),
  });
}
```

---

## UI Behavior Recommendations

- Disable `Retry` button unless `status === 'error'`.
- Disable `Force Scan` button when `status === 'scanning' || status === 'syncing'`.
- Show `last_error` prominently when status is `error`.
- For detail page, auto-refresh while `scanning/syncing`.
