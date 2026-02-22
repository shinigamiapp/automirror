# Backend API — Izanami

## Base URL
```
https://api.shngm.io/v1
```

---


### Bypassing Authorization with X-API-KEY

For server-to-server requests where setting the `Authorization` header is inconvenient, you can pass the token via the `X-API-KEY` header instead:

```
X-API-KEY: {server_token}
```

This bypasses the standard `Authorization` header check and is accepted by admin/server-authenticated endpoints.

---

## Response Envelope

All responses are wrapped in a standard envelope:

```json
{
  "retcode": 200,
  "message": "OK",
  "data": { ... },
  "meta": {
    "page": 1,
    "page_size": 10,
    "total_page": 5,
    "total_record": 48,
    "process_time": "12ms",
    "request_id": "abc-123",
    "timestamp": 1740200000
  }
}
```

| Field     | Type    | Description                                      |
|-----------|---------|--------------------------------------------------|
| `retcode` | integer | HTTP-equivalent status code                      |
| `message` | string  | Human-readable status message                    |
| `data`    | any     | Response payload (object, array, or null)        |
| `error`   | string  | Error message (present only on failure responses) |
| `meta`    | object  | Pagination and request metadata (when applicable) |

---

## Table of Contents

- [GET `/chapter/{manga_id}/list`](#get-chaptermanga_idlist)
- [POST `/admin/chapter/create/{manga_id}`](#post-adminchaptercreatemanga_id)

---

## GET `/chapter/{manga_id}/list`

Retrieves a paginated list of chapters for a given manga.

> **Authentication:** None required.

### Path Parameters

| Parameter  | Type   | Required | Description     |
|------------|--------|----------|-----------------|
| `manga_id` | string | Yes      | ID of the manga |

### Query Parameters

| Parameter    | Type    | Required | Default          | Description                                        |
|--------------|---------|----------|------------------|----------------------------------------------------|
| `sort_by`    | string  | No       | `chapter_number` | Field to sort by: `chapter_number`, `release_date` |
| `sort_order` | string  | No       | `desc`           | Sort direction: `asc`, `desc`                      |
| `search`     | integer | No       |                  | Filter by chapter number                           |
| `page`       | integer | No       | `1`              | Page number                                        |
| `page_size`  | integer | No       | `10`             | Number of items per page                           |

### Example Request

```bash
curl "https://api.shngm.io/v1/chapter/battle-through-the-heavens-return/list?sort_by=chapter_number&sort_order=asc&page=1&page_size=20"
```

### Success Response (HTTP 200)

```json
{
  "retcode": 200,
  "message": "OK",
  "data": [
    {
      "chapter_id": "c1a2b3c4-...",
      "manga_id": "battle-through-the-heavens-return",
      "chapter_number": 1,
      "chapter_title": "Chapter 1",
      "thumbnail_image_url": "https://assets.shinigami.io/thumbnail/chapter/...",
      "view_count": 1024,
      "release_date": "2026-01-01T00:00:00Z"
    },
    {
      "chapter_id": "d2e3f4a5-...",
      "manga_id": "battle-through-the-heavens-return",
      "chapter_number": 2,
      "chapter_title": "Chapter 2",
      "thumbnail_image_url": "https://assets.shinigami.io/thumbnail/chapter/...",
      "view_count": 980,
      "release_date": "2026-01-08T00:00:00Z"
    }
  ],
  "meta": {
    "page": 1,
    "page_size": 20,
    "total_page": 3,
    "total_record": 50
  }
}
```

### Chapter Object Fields

| Field                 | Type    | Description                         |
|-----------------------|---------|-------------------------------------|
| `chapter_id`          | string  | Unique chapter UUID                 |
| `manga_id`            | string  | Parent manga ID                     |
| `chapter_number`      | number  | Chapter number (supports decimals)  |
| `chapter_title`       | string  | Display title of the chapter        |
| `thumbnail_image_url` | string  | URL of the chapter thumbnail        |
| `view_count`          | integer | Total view count                    |
| `release_date`        | string  | ISO 8601 release date               |

### Error Responses

| Status | Description        | Body                                         |
|--------|--------------------|----------------------------------------------|
| 400    | Bad request        | `{ "retcode": 400, "error": "Bad Request" }` |
| 404    | Manga not found    | `{ "retcode": 404, "error": "Not Found" }`   |
| 500    | Internal server error | `{ "retcode": 500, "error": "Internal Server Error" }` |

---

## POST `/admin/chapter/create/{manga_id}`

Creates one or more chapters for a manga in a single request.

> **Authentication:** Server Token required (`Authorization: Bearer {server_token}` or `X-API-KEY: {server_token}`).

### Path Parameters

| Parameter  | Type   | Required | Description                          |
|------------|--------|----------|--------------------------------------|
| `manga_id` | string | Yes      | ID of the manga to add chapters to   |

### Request Body

| Field      | Type  | Required | Description                               |
|------------|-------|----------|-------------------------------------------|
| `chapters` | array | Yes      | Array of chapter objects (minimum 1 item) |

#### Chapter Object

| Field                 | Type     | Required | Description                                           |
|-----------------------|----------|----------|-------------------------------------------------------|
| `chapter_id`          | string   | Yes      | Unique chapter ID (UUID)                              |
| `chapter_number`      | number   | Yes      | Chapter number (e.g. `36` or `36.5`)                  |
| `chapter_title`       | string   | No       | Display title for the chapter                         |
| `chapter_images`      | string[] | No       | Array of image filenames inside the ZIP               |
| `path`                | string   | No       | R2 storage path to the chapter ZIP file               |
| `release_date`        | string   | No       | ISO 8601 release date (e.g. `2026-02-22T00:00:00Z`)   |
| `thumbnail_image_url` | string   | No       | URL of the chapter thumbnail                          |

### Example Request

```bash
curl -X POST https://api.shngm.io/v1/admin/chapter/create/battle-through-the-heavens-return \
  -H "X-API-KEY: {server_token}" \
  -H "Content-Type: application/json" \
  -d '{
    "chapters": [
      {
        "chapter_id": "c1a2b3c4-0000-0000-0000-000000000001",
        "chapter_number": 36,
        "chapter_title": "Chapter 36",
        "path": "chapter/scraper/battle-through-the-heavens-return/battle-through-the-heavens-return-chapter-36.zip",
        "chapter_images": ["1.jpg", "2.jpg", "3.jpg"],
        "thumbnail_image_url": "https://assets.shinigami.io/thumbnail/chapter/chapter-36.jpg",
        "release_date": "2026-02-22T00:00:00Z"
      }
    ]
  }'
```

### Success Response (HTTP 200)

```json
{
  "retcode": 200,
  "message": "Chapter created successfully"
}
```

### Error Responses

| Status | Description        | Body                                          |
|--------|--------------------|-----------------------------------------------|
| 400    | Bad request        | `{ "retcode": 400, "error": "Bad request" }`  |
| 500    | Internal server error | `{ "retcode": 500, "error": "Internal server error" }` |

### Notes
- The `path` field should match the R2 key produced by `POST /uploads/chapter` on the Scraper API — i.e. `chapter/scraper/{manga_id}/{manga_id}-chapter-{chapterNumber}.zip`.
- Use `GET /chapter/{manga_id}/list` first to check which chapters already exist and avoid creating duplicates.
