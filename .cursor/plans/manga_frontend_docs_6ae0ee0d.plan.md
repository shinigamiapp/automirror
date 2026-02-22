---
name: Manga Frontend Docs
overview: "Create a React frontend reference document covering the /manga and /health API endpoints: TypeScript types, API client, React hooks, and a table UI design for the manga registry dashboard."
todos:
  - id: types-file
    content: Create src/types/manga.ts with Manga, AddMangaPayload, UpdateMangaPayload, HealthCheck interfaces
    status: pending
  - id: api-client
    content: Create src/api/manga.ts with mangaApi and healthApi client functions
    status: pending
  - id: hooks
    content: Create src/hooks/useManga.ts with all TanStack Query hooks
    status: pending
  - id: status-badge
    content: Create MangaStatusBadge component
    status: pending
  - id: sync-progress
    content: Create SyncProgress component
    status: pending
  - id: health-banner
    content: Create HealthBanner component using useHealth hook
    status: pending
  - id: manga-table
    content: Create MangaTable component with all columns
    status: pending
isProject: false
---

# React Frontend Reference - Manga Registry API

This is a **reference document** (not a full app). It covers everything needed to implement the manga registry dashboard in any React project.

---

## API Base URL

```typescript
const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';
```

---

## TypeScript Types (Frontend)

Create `src/types/manga.ts` in your frontend project:

```typescript
// src/types/manga.ts

export type MangaStatus = 'idle' | 'scanning' | 'syncing' | 'error';

export interface Manga {
  id: string;
  manga_id: string;
  manga_url: string;
  source_domain: string;
  manga_slug: string;
  series_title: string;
  // Settings
  auto_sync_enabled: number; // 0 or 1 (SQLite boolean)
  check_interval_minutes: number;
  priority: number;
  // Chapter counts
  source_chapter_count: number;
  source_last_chapter: number | null;
  backend_chapter_count: number;
  backend_last_chapter: number | null;
  // Status
  status: MangaStatus;
  sync_progress_total: number;
  sync_progress_completed: number;
  sync_progress_failed: number;
  // Timestamps
  last_scanned_at: string | null;
  last_synced_at: string | null;
  next_scan_at: string | null;
  // Errors
  last_error: string | null;
  last_error_at: string | null;
  consecutive_failures: number;
  created_at: string;
  updated_at: string;
}

export interface AddMangaPayload {
  manga_url: string;
  manga_id: string;
  series_title: string;
  source_domain: string;
  manga_slug: string;
  auto_sync_enabled?: boolean;
  check_interval_minutes?: number;
  priority?: number;
}

export interface UpdateMangaPayload {
  auto_sync_enabled?: boolean;
  check_interval_minutes?: number;
  priority?: number;
}

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface HealthCheck {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  checks: {
    database: { healthy: boolean; error?: string };
    scraper: { healthy: boolean; status?: number; error?: string };
    uploader: { healthy: boolean; status?: number; error?: string };
    backend: { healthy: boolean; status?: number; error?: string };
  };
  workers: Record<string, {
    name: string;
    isRunning: boolean;
    isShuttingDown: boolean;
    consecutiveErrors: number;
    lastTickStart: number;
  }>;
  circuits: Record<string, 'closed' | 'open' | 'half-open'>;
  queues: {
    pending_tasks: number;
    syncing_manga: number;
    failed_tasks: number;
    scanning_manga: number;
  };
}
```

---

## API Client

Create `src/api/manga.ts`:

```typescript
// src/api/manga.ts
const API_BASE = import.meta.env.VITE_API_URL ?? 'http://localhost:3000';

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
    ...init,
  });
  const json: ApiResponse<T> = await res.json();
  if (!res.ok || !json.success) {
    throw new Error(json.error ?? `Request failed: ${res.status}`);
  }
  return json.data as T;
}

export const mangaApi = {
  // GET /manga
  list: () =>
    apiFetch<Manga[]>('/manga'),

  // GET /manga/:id
  get: (id: string) =>
    apiFetch<Manga>(`/manga/${id}`),

  // POST /manga
  add: (payload: AddMangaPayload) =>
    apiFetch<Manga>('/manga', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  // PATCH /manga/:id
  update: (id: string, payload: UpdateMangaPayload) =>
    apiFetch<Manga>(`/manga/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    }),

  // DELETE /manga/:id
  remove: (id: string) =>
    apiFetch<void>(`/manga/${id}`, { method: 'DELETE' }),

  // POST /manga/:id/force-scan
  forceScan: (id: string) =>
    apiFetch<void>(`/manga/${id}/force-scan`, { method: 'POST' }),

  // POST /manga/:id/retry
  retry: (id: string) =>
    apiFetch<void>(`/manga/${id}/retry`, { method: 'POST' }),
};

// GET /health
export const healthApi = {
  get: () => apiFetch<HealthCheck>('/health'),
};
```

---

## React Hooks (TanStack Query)

Create `src/hooks/useManga.ts`:

```typescript
// src/hooks/useManga.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { mangaApi, healthApi } from '../api/manga';

// List all manga - auto-refresh every 15 seconds
export function useMangaList() {
  return useQuery({
    queryKey: ['manga'],
    queryFn: mangaApi.list,
    refetchInterval: 15_000,
  });
}

// Single manga detail
export function useManga(id: string) {
  return useQuery({
    queryKey: ['manga', id],
    queryFn: () => mangaApi.get(id),
    enabled: !!id,
    refetchInterval: 5_000, // poll faster when viewing detail
  });
}

// Add manga
export function useAddManga() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: mangaApi.add,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['manga'] }),
  });
}

// Update manga settings
export function useUpdateManga() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateMangaPayload }) =>
      mangaApi.update(id, payload),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['manga'] });
      qc.invalidateQueries({ queryKey: ['manga', id] });
    },
  });
}

// Delete manga
export function useDeleteManga() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: mangaApi.remove,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['manga'] }),
  });
}

// Force scan
export function useForceScan() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: mangaApi.forceScan,
    onSuccess: () => qc.invalidateQueries({ queryKey: ['manga'] }),
  });
}

// Retry failed tasks
export function useRetryManga() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: mangaApi.retry,
    onSuccess: (_, id) => qc.invalidateQueries({ queryKey: ['manga', id] }),
  });
}

// Health check - refresh every 30s
export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: healthApi.get,
    refetchInterval: 30_000,
  });
}
```

---

## Table UI Design

The manga registry table in the dashboard:

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  Manga Registry                                              [ + Add Manga ]  [ Health: ● Healthy ]  │
├──────────────────────────┬──────────────────┬──────────┬─────────────┬──────────────┬───────────────┤
│  Title                   │  Source          │  Status  │  Chapters   │  Last Scanned│  Actions      │
├──────────────────────────┼──────────────────┼──────────┼─────────────┼──────────────┼───────────────┤
│  All Hail The Sect Leader│  apkomik.cc      │ ● idle   │  523 / 523  │  2 min ago   │ [Scan] [···]  │
├──────────────────────────┼──────────────────┼──────────┼─────────────┼──────────────┼───────────────┤
│  Martial Peak            │  mangahere.cc    │ ↻ syncing│  150 / 200  │  5 min ago   │ [Scan] [···]  │
│                          │                  │          │  ▓▓▓▓▓░░░░░ │              │               │
│                          │                  │          │  75% (3 fail)│             │               │
├──────────────────────────┼──────────────────┼──────────┼─────────────┼──────────────┼───────────────┤
│  Solo Leveling           │  reaperscans.com │ ⟳ scan.. │  — / 200    │  just now    │ [Scan] [···]  │
├──────────────────────────┼──────────────────┼──────────┼─────────────┼──────────────┼───────────────┤
│  Tower of God            │  webtoons.com    │ ✕ error  │  500 / 600  │  1 hr ago    │ [Retry][···]  │
│                          │                  │ 3 failures│            │              │               │
├──────────────────────────┼──────────────────┼──────────┼─────────────┼──────────────┼───────────────┤
│  Berserk                 │  mangadex.org    │ ● idle   │  364 / 364  │  30 min ago  │ [Scan] [···]  │
└──────────────────────────┴──────────────────┴──────────┴─────────────┴──────────────┴───────────────┘
                                                                  Showing 5 of 1,024 manga
```

**Column breakdown:**

- **Title** - `series_title`, clickable to open detail drawer
- **Source** - `source_domain`, with favicon
- **Status** - colored badge mapped from `status` field:
  - `idle` = green dot
  - `scanning` = blue spinner
  - `syncing` = blue spinner + progress bar `sync_progress_completed / sync_progress_total`
  - `error` = red X + `consecutive_failures` count
- **Chapters** - `backend_chapter_count / source_chapter_count`, with progress bar if syncing
- **Last Scanned** - `last_scanned_at` as relative time (e.g. "2 min ago")
- **Actions** - `[Scan]` triggers force-scan, `[···]` opens dropdown with: Edit, Retry, Delete

---

## Status Badge Component

```typescript
// src/components/MangaStatusBadge.tsx
const STATUS_MAP = {
  idle:     { label: 'Idle',     color: 'green',  icon: '●' },
  scanning: { label: 'Scanning', color: 'blue',   icon: '⟳' },
  syncing:  { label: 'Syncing',  color: 'blue',   icon: '↻' },
  error:    { label: 'Error',    color: 'red',     icon: '✕' },
} satisfies Record<MangaStatus, { label: string; color: string; icon: string }>;

export function MangaStatusBadge({ manga }: { manga: Manga }) {
  const s = STATUS_MAP[manga.status];
  return (
    <span className={`badge badge-${s.color}`}>
      {s.icon} {s.label}
      {manga.status === 'error' && manga.consecutive_failures > 0 && (
        <span className="ml-1 text-xs">({manga.consecutive_failures} failures)</span>
      )}
    </span>
  );
}
```

---

## Progress Bar (Syncing State)

```typescript
// src/components/SyncProgress.tsx
export function SyncProgress({ manga }: { manga: Manga }) {
  if (manga.status !== 'syncing' || manga.sync_progress_total === 0) {
    return <span>{manga.backend_chapter_count} / {manga.source_chapter_count}</span>;
  }
  const pct = Math.round((manga.sync_progress_completed / manga.sync_progress_total) * 100);
  return (
    <div>
      <div className="text-xs">
        {manga.sync_progress_completed}/{manga.sync_progress_total}
        {manga.sync_progress_failed > 0 && (
          <span className="text-red-500 ml-1">({manga.sync_progress_failed} failed)</span>
        )}
      </div>
      <div className="w-full bg-gray-200 rounded h-1.5 mt-1">
        <div className="bg-blue-500 h-1.5 rounded" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
```

---

## Health Banner (Top of Page)

```typescript
// src/components/HealthBanner.tsx
export function HealthBanner() {
  const { data: health, isError } = useHealth();

  if (isError) return <div className="banner banner-red">API Unreachable</div>;
  if (!health) return null;

  const isHealthy = health.status === 'healthy';
  return (
    <div className={`banner ${isHealthy ? 'banner-green' : 'banner-yellow'}`}>
      <span>{isHealthy ? '● Healthy' : '⚠ Degraded'}</span>
      <span className="ml-4 text-xs">
        Pending: {health.queues.pending_tasks} tasks
        · Syncing: {health.queues.syncing_manga} manga
        · Failed: {health.queues.failed_tasks} tasks
      </span>
    </div>
  );
}
```

---

## Endpoint Summary


| Method | Endpoint                | Usage                   | Hook               |
| ------ | ----------------------- | ----------------------- | ------------------ |
| GET    | `/manga`                | List all manga          | `useMangaList()`   |
| GET    | `/manga/:id`            | Single manga + progress | `useManga(id)`     |
| POST   | `/manga`                | Add to registry         | `useAddManga()`    |
| PATCH  | `/manga/:id`            | Update settings         | `useUpdateManga()` |
| DELETE | `/manga/:id`            | Remove manga            | `useDeleteManga()` |
| POST   | `/manga/:id/force-scan` | Trigger scan now        | `useForceScan()`   |
| POST   | `/manga/:id/retry`      | Reset failed tasks      | `useRetryManga()`  |
| GET    | `/health`               | System health           | `useHealth()`      |


