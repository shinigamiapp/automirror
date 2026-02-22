---
name: Fix API Endpoints
overview: Remove deprecated /jobs and /sync-jobs routes, fix all external API calls to match actual documentation (Scraper, Backend, Uploader), implement the optimized metadata-first scanning flow, and add X-API-KEY authentication to this worker's endpoints.
todos:
  - id: remove-deprecated-routes
    content: Delete /jobs and /sync-jobs routes, schemas, and repositories
    status: pending
  - id: add-api-key-auth
    content: Add X-API-KEY authentication middleware to protect /manga endpoints using ADMIN_API_KEY from config
    status: pending
  - id: fix-scraper-service
    content: "Rewrite scraper.ts with correct endpoints: GET /manga/detail, GET /manga/chapter/list, GET /manga/chapter/detail, POST /uploads/chapter"
    status: pending
  - id: fix-backend-service
    content: "Fix backend.ts: GET /chapter/{manga_id}/list with X-API-KEY header, add POST /admin/chapter/create/{manga_id}"
    status: pending
  - id: fix-uploader-service
    content: "Fix uploader.ts: POST /v1/upload/single with correct request/response structure"
    status: pending
  - id: update-types
    content: Update types.ts with correct response structures from all APIs
    status: pending
  - id: fix-scanner
    content: Update scanner.ts to use metadata-first check before fetching full chapter list
    status: pending
  - id: fix-sync-processor
    content: "Rewrite sync-processor.ts with new 4-step flow: get images -> create ZIP -> upload -> create chapter"
    status: pending
  - id: create-manga-routes
    content: "Create /manga routes with CRUD endpoints: POST /manga, GET /manga, GET /manga/:id, PUT /manga/:id, DELETE /manga/:id, POST /manga/:id/force-scan, POST /manga/:id/retry"
    status: pending
isProject: false
---

# Fix API Endpoints and External Service Calls

## Summary of Changes

1. **Remove `/jobs` and `/sync-jobs` routes** - All syncing is now automatic via `/manga` registry
2. **Add X-API-KEY authentication** - Protect this worker's `/manga` endpoints with `ADMIN_API_KEY`
3. **Create `/manga` routes** - CRUD endpoints for manga registry
4. **Fix Scraper API calls** - Use correct endpoints: `GET /manga/detail`, `GET /manga/chapter/list`, `GET /manga/chapter/detail`, `POST /uploads/chapter`
5. **Fix Backend API calls** - Use correct endpoint: `GET /chapter/{manga_id}/list` and `POST /admin/chapter/create/{manga_id}`
6. **Fix Uploader API calls** - Use correct endpoint: `POST /v1/upload/single`
7. **Implement new upload flow** - Get images -> Create ZIP via scraper -> Upload via uploader -> Create chapter in backend

---

## 1. Remove Deprecated Routes

Delete these files:

- `src/routes/jobs.ts`
- `src/routes/sync-jobs.ts`
- `src/schemas/jobs.ts` (if only used by jobs/sync-jobs)
- `src/db/repositories/jobs.ts`
- `src/db/repositories/sync-jobs.ts`

Remove from `src/app.ts`:

- Registration of `/jobs` routes
- Registration of `/sync-jobs` routes

---

## 2. Add X-API-KEY Authentication

Create `src/hooks/auth.ts`:

```typescript
import { FastifyRequest, FastifyReply } from 'fastify';
import { CONFIG } from '../config.js';

export async function requireApiKey(request: FastifyRequest, reply: FastifyReply) {
  const apiKey = request.headers['x-api-key'];
  
  if (!apiKey || apiKey !== CONFIG.ADMIN_API_KEY) {
    return reply.code(401).send({
      success: false,
      error: 'Invalid or missing X-API-KEY header',
    });
  }
}
```

Apply to `/manga` routes in `src/app.ts`:

```typescript
await app.register(mangaRoutes, { 
  prefix: '/manga',
  preHandler: requireApiKey,
});
```

Endpoints that require auth:

- All `/manga/*` endpoints (CRUD, force-scan, retry)

Endpoints that remain public:

- `GET /health`
- `POST /webhooks/*` (if using webhook secrets instead)

---

## 3. Create `/manga` Routes (`src/routes/manga.ts`)


| Method | Endpoint                | Description                                   |
| ------ | ----------------------- | --------------------------------------------- |
| POST   | `/manga`                | Register manga for auto-sync                  |
| GET    | `/manga`                | List all manga (table view with status)       |
| GET    | `/manga/:id`            | Get manga details + failed tasks              |
| PUT    | `/manga/:id`            | Update settings (interval, enabled, priority) |
| DELETE | `/manga/:id`            | Remove from registry + cancel active sync     |
| POST   | `/manga/:id/force-scan` | Trigger immediate scan                        |
| POST   | `/manga/:id/retry`      | Retry failed tasks immediately                |
| POST   | `/manga/bulk`           | Register multiple manga                       |
| PUT    | `/manga/update-domain`  | Bulk domain migration                         |


---

## 5. Fix Scraper Service (`src/services/scraper.ts`)

### Current (WRONG):

- `POST /scrape/chapters` with body `{ url }` 
- `POST /scrape/chapter` with body `{ url }`

### Correct Endpoints:

**a) Get Manga Metadata (lightweight check)**

```
GET /manga/detail?url={manga_url}
```

Response includes `chapterSummary.lastChapter.number` for quick comparison.

**b) Get Chapter List (full list when needed)**

```
GET /manga/chapter/list?url={manga_url}&page=1&limit=50
```

Returns paginated chapter list with `{ url, title, date }`.

**c) Get Chapter Images**

```
GET /manga/chapter/detail?url={chapter_url}
```

Returns `{ images: string[], title, prevChapter, nextChapter }`.

**d) Create ZIP from Images**

```
POST /uploads/chapter
Body: { imageDataArray, manga_id, chapterNumber, seriesTitle, chapterUrl }
```

Returns `{ data: { publicUrl, fileName, totalImages } }`.

---

## 6. Fix Backend Service (`src/services/backend.ts`)

### Current (WRONG):

```
GET /api/manga/{manga_id}/chapters?page=X&per_page=100
Header: Authorization: Bearer {token}
```

### Correct:

```
GET /chapter/{manga_id}/list?page=X&page_size=100&sort_order=asc
Header: X-API-KEY: {token}
```

Response structure:

```json
{
  "retcode": 200,
  "data": [{ "chapter_id", "chapter_number", ... }],
  "meta": { "page", "page_size", "total_page", "total_record" }
}
```

**Add: Create Chapter Endpoint**

```
POST /admin/chapter/create/{manga_id}
Header: X-API-KEY: {token}
Body: { chapters: [{ chapter_id, chapter_number, path, chapter_images, ... }] }
```

---

## 7. Fix Uploader Service (`src/services/uploader.ts`)

### Current (WRONG):

```
POST /v1/upload/job
```

### Correct:

```
POST /v1/upload/single
Header: X-API-Key: {key}
Body: { zip_url, manga_id, chapter_number }
```

Response:

```json
{
  "results": {
    "manga_id": "...",
    "chapter_id": "...",
    "chapter_number": "1",
    "data": ["001-a1b2.jpg", ...],
    "path": "/chapter/manga_{id}/chapter_{id}/"
  }
}
```

---

## 8. New Upload Flow in Sync Processor

The correct flow per the docs:

```
1. GET /manga/chapter/detail?url={chapter_url}
   -> Get images[] array

2. POST /uploads/chapter (Scraper API)
   -> Body: { imageDataArray, manga_id, chapterNumber, seriesTitle, chapterUrl }
   -> Returns: { data: { publicUrl } }

3. POST /v1/upload/single (Uploader API)
   -> Body: { zip_url: publicUrl, manga_id, chapter_number }
   -> Returns: { results: { chapter_id, data, path } }

4. POST /admin/chapter/create/{manga_id} (Backend API)
   -> Body: { chapters: [{ chapter_id, chapter_number, path, chapter_images }] }
```

---

## 9. Optimized Scanner with Metadata-First Check

Update `src/workers/scanner.ts`:

```typescript
// Step 1: Quick metadata check
const metadata = await getMangaMetadata(manga.manga_url);
const sourceLastChapter = metadata.chapterSummary.lastChapter.number;

// Step 2: Skip if no new chapters
if (sourceLastChapter === manga.source_last_chapter) {
  // Just update next_scan_at, skip full chapter fetch
  return;
}

// Step 3: Only fetch full list when there ARE new chapters
const sourceChapters = await getChapterList(manga.manga_url);
// ... continue with diff logic
```

---

## Files to Modify


| File                            | Action                                            |
| ------------------------------- | ------------------------------------------------- |
| `src/hooks/auth.ts`             | CREATE - X-API-KEY authentication hook            |
| `src/routes/manga.ts`           | CREATE - /manga CRUD endpoints                    |
| `src/services/scraper.ts`       | Rewrite all functions to match docs               |
| `src/services/backend.ts`       | Fix endpoint URLs and add createChapter           |
| `src/services/uploader.ts`      | Fix endpoint and response handling                |
| `src/workers/scanner.ts`        | Add metadata-first optimization                   |
| `src/workers/sync-processor.ts` | Implement new 4-step upload flow                  |
| `src/types.ts`                  | Update response types to match actual APIs        |
| `src/routes/jobs.ts`            | DELETE                                            |
| `src/routes/sync-jobs.ts`       | DELETE                                            |
| `src/app.ts`                    | Remove jobs/sync-jobs, add manga routes with auth |


---

## Type Definitions to Update

```typescript
// Scraper Types
interface MangaMetadataResponse {
  metadata: { title, cover, ... };
  chapterSummary: {
    total: number;
    lastChapter: { number, title, url };
    firstChapter: { number, title, url };
  };
}

interface ChapterListResponse {
  status: 'ready' | 'loading' | 'not_cached';
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
  data: Array<{ title, url, date }>;
}

interface ChapterDetailResponse {
  images: string[];
  title: string;
  prevChapter: string | null;
  nextChapter: string | null;
}

interface UploadChapterResponse {
  success: boolean;
  data: { publicUrl, fileName, totalImages };
}

// Backend Types
interface BackendResponse<T> {
  retcode: number;
  message: string;
  data: T;
  meta?: { page, page_size, total_page, total_record };
}

// Uploader Types
interface UploaderResponse {
  message: string;
  results: {
    manga_id: string;
    chapter_number: string;
    chapter_id: string;
    data: string[];
    path: string;
  };
}
```

