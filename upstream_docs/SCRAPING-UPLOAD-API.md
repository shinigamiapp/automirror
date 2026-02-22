# Scraper API

## Base URL
```
https://scraper.shinigami.io
```

## Table of Contents
- [GET `/manga/detail`](#get-mangadetail)
- [GET `/manga/chapter/list`](#get-mangachapterlist)
- [GET `/manga/chapter/detail`](#get-mangachapterdetail)
- [POST `/uploads/chapter`](#post-uploadschapter)

---

## GET `/manga/detail`

Fetches metadata for a specific manga series plus a lightweight chapter summary (total count, first/last chapter). The full chapter list is available separately via [`/manga/chapter/list`](#get-mangachapterlist).

### Query Parameters

| Parameter | Type    | Required | Description                                           |
|-----------|---------|----------|-------------------------------------------------------|
| `url`     | string  | Yes      | The manga detail page URL                             |
| `refresh` | boolean | No       | Set `true` to invalidate the cache and re-fetch       |

### Example Request

```bash
curl "https://scraper.shinigami.io/manga/detail?url=https://apkomik.cc/manga/supreme-academy-genius/"
```

### Success Response (HTTP 200)

```json
{
  "metadata": {
    "link": "https://apkomik.cc/manga/supreme-academy-genius/",
    "cover": "https://example.com/cover.jpg",
    "title": "Supreme Academy Genius",
    "description": "A genius student...",
    "originTitle": "최고의 학원천재",
    "release": "2024",
    "authors": ["Author Name"],
    "artists": ["Artist Name"],
    "tags": ["Manhwa"],
    "genres": ["Action", "Fantasy", "School Life"],
    "MangaType": "Manhwa",
    "status": "Ongoing"
  },
  "chapters": {
    "status": "not_cached",
    "total": 26,
    "cachedAt": null,
    "hasCache": false
  },
  "chapterSummary": {
    "total": 26,
    "lastChapter": {
      "number": 26,
      "title": "Chapter 26",
      "url": "https://apkomik.cc/manga/supreme-academy-genius/chapter-26/"
    },
    "firstChapter": {
      "number": 1,
      "title": "Chapter 1",
      "url": "https://apkomik.cc/manga/supreme-academy-genius/chapter-1/"
    }
  }
}
```

### `chapters.status` Values

| Value         | Meaning                                              |
|---------------|------------------------------------------------------|
| `not_cached`  | No chapter list in cache. Call `/manga/chapter/list` to fetch and cache it. |
| `loading`     | Chapter list is currently being fetched.             |
| `ready`       | Chapter list is cached and ready.                    |

### Error Responses

**Missing `url` parameter (HTTP 400):**
```json
{
  "error": "Parameter 'url' is required."
}
```

**Manga not found (HTTP 404):**
```json
{
  "error": "Manga not found or could not be scraped."
}
```

**Scraping/server failure (HTTP 500):**
```json
{
  "error": "Internal server error"
}
```

### Notes
- `chapterSummary` provides accurate first/last chapter info for quick comparison against your backend — without fetching the full chapter list.
- Theme detection is performed automatically based on the provided URL (e.g., MangaStream, Kiryuu, Madara).
- KomikCast URLs use a direct API call instead of HTML parsing.
- For Kiryuu/ikiru sites, a lightweight AJAX call is made to obtain the real last chapter number and URL (not estimated from count).

---

## GET `/manga/chapter/list`

Fetches the full paginated chapter list for a manga. Results are cached in memory (30-minute TTL); the first call triggers the fetch and populates the cache.

### Query Parameters

| Parameter | Type    | Required | Description                                                |
|-----------|---------|----------|------------------------------------------------------------|
| `url`     | string  | Yes      | The manga detail page URL                                  |
| `page`    | integer | No       | Page number (default: `1`)                                 |
| `limit`   | integer | No       | Items per page (default: `50`, max: `200`)                 |
| `refresh` | boolean | No       | Set `true` to invalidate the cache and re-fetch            |

### Example Request

```bash
curl "https://scraper.shinigami.io/manga/chapter/list?url=https://apkomik.cc/manga/supreme-academy-genius/&page=1&limit=50"
```

### Success Response (HTTP 200)

```json
{
  "status": "ready",
  "page": 1,
  "limit": 50,
  "total": 26,
  "hasMore": false,
  "cachedAt": 1740220800000,
  "data": [
    {
      "title": "Chapter 26",
      "url": "https://apkomik.cc/manga/supreme-academy-genius/chapter-26/",
      "date": "2026-02-15"
    },
    {
      "title": "Chapter 25",
      "url": "https://apkomik.cc/manga/supreme-academy-genius/chapter-25/",
      "date": "2026-02-10"
    }
  ]
}
```

### Response when cache is still loading

```json
{
  "status": "loading",
  "page": 1,
  "limit": 50,
  "total": 0,
  "hasMore": false,
  "cachedAt": null,
  "data": []
}
```

### Error Responses

**Missing `url` parameter (HTTP 400):**
```json
{
  "error": "Parameter 'url' is required."
}
```

**Scraping/server failure (HTTP 500):**
```json
{
  "error": "Internal server error"
}
```

### Notes
- `data` is ordered from latest to oldest.
- `cachedAt` is a Unix timestamp (ms). Use it to determine cache freshness.
- Cache TTL is 30 minutes. Pass `refresh=true` to force a re-fetch.

---

## GET `/manga/chapter/detail`

Fetches all image URLs for a specific chapter page, along with navigation links to the previous and next chapters.

### Query Parameters

| Parameter | Type   | Required | Description              |
|-----------|--------|----------|--------------------------|
| `url`     | string | Yes      | The chapter page URL     |

### Example Request

```bash
curl "https://scraper.shinigami.io/manga/chapter/detail?url=https://apkomik.cc/manga/supreme-academy-genius/chapter-26/"
```

### Success Response (HTTP 200)

```json
{
  "images": [
    "https://cdn.example.com/images/001.webp",
    "https://cdn.example.com/images/002.webp",
    "https://cdn.example.com/images/003.webp",
    "https://cdn.example.com/images/004.webp"
  ],
  "title": "Supreme Academy Genius - Chapter 26",
  "prevChapter": "https://apkomik.cc/manga/supreme-academy-genius/chapter-25/",
  "nextChapter": null
}
```

### Error Responses

**Missing `url` parameter (HTTP 400):**
```json
{
  "error": "Parameter 'url' is required."
}
```

**Scraping/server failure (HTTP 500):**
```json
{
  "error": "Internal server error"
}
```

### Notes
- `prevChapter` and `nextChapter` will be `null` when there is no adjacent chapter.
- The `images` array contains direct CDN URLs ready for download.
- Image URLs may require the chapter page as a `Referer` header when downloading (see [`/uploads/chapter`](#post-uploadschapter)).

---

## POST `/uploads/chapter`

Downloads chapter images from the provided URLs, packages them into a ZIP file, uploads the ZIP to R2 storage, and returns the public URL.

### Request Body

| Parameter        | Type     | Required | Description                                                                 |
|------------------|----------|----------|-----------------------------------------------------------------------------|
| `imageDataArray` | array    | Yes      | Array of image objects, each with `index` and `download_url`                |
| `manga_id`       | string   | Yes      | Manga identifier/slug — used for the R2 storage path and file naming        |
| `chapterNumber`  | string   | Yes      | Chapter number (e.g., `"26"` or `"26.5"`)                                   |
| `seriesTitle`    | string   | Yes      | Series title — used for logging purposes                                     |
| `chapterUrl`     | string   | No       | Source chapter URL — sent as `Referer` header when downloading images        |

### `imageDataArray` Format

```json
[
  { "index": 1, "download_url": "https://cdn.example.com/001.webp" },
  { "index": 2, "download_url": "https://cdn.example.com/002.webp" },
  { "index": 3, "download_url": "https://cdn.example.com/003.webp" }
]
```

### Example Request

```bash
curl -X POST https://scraper.shinigami.io/uploads/chapter \
  -H "Content-Type: application/json" \
  -d '{
    "imageDataArray": [
      { "index": 1, "download_url": "https://sv1.imgkc1.my.id/wp-content/img/B/Battle-Through-the-Heavens-Return/036/001.jpg" },
      { "index": 2, "download_url": "https://sv1.imgkc1.my.id/wp-content/img/B/Battle-Through-the-Heavens-Return/036/002.jpg" },
      { "index": 3, "download_url": "https://sv1.imgkc1.my.id/wp-content/img/B/Battle-Through-the-Heavens-Return/036/003.jpg" }
    ],
    "manga_id": "battle-through-the-heavens-return",
    "chapterNumber": "36",
    "seriesTitle": "Battle Through the Heavens Return",
    "chapterUrl": "https://v1.komikcast.fit/series/battle-through-the-heavens-return/chapter/36"
  }'
```

### Success Response (HTTP 200)

```json
{
  "success": true,
  "message": "Chapter uploaded successfully",
  "data": {
    "publicUrl": "https://assets.shinigami.io/chapter/scraper/battle-through-the-heavens-return/battle-through-the-heavens-return-chapter-36.zip",
    "fileName": "battle-through-the-heavens-return-chapter-36.zip",
    "totalImages": 3
  }
}
```

### Error Responses

**Missing `imageDataArray` (HTTP 400):**
```json
{
  "error": "Parameter 'imageDataArray' is required."
}
```

**Missing required parameters (HTTP 400):**
```json
{
  "error": "Parameter 'manga_id', 'chapterNumber', and 'seriesTitle' are required."
}
```

**`imageDataArray` is not an array (HTTP 400):**
```json
{
  "error": "Parameter 'imageDataArray' is required and must be an array."
}
```

**Download or upload failure (HTTP 500):**
```json
{
  "error": "Terjadi kesalahan saat mengunduh chapter."
}
```

### R2 Storage Path

```
chapter/scraper/{manga_id}/{manga_id}-chapter-{chapterNumber}.zip
```

### ZIP File Structure

Images inside the ZIP are renamed to `{index}.{extension}`:

```
1.jpg
2.jpg
3.jpg
...
```

### Supported Image Extensions

| Extension | Notes             |
|-----------|-------------------|
| `webp`    |                   |
| `jpg`     |                   |
| `jpeg`    |                   |
| `gif`     |                   |
| `png`     | Default if unknown |

### Processing Flow

```
1. Receive imageDataArray + metadata
2. Download each image (up to 7 retries, 5s delay between retries)
3. Save to:  tmp/images/{manga_id}/chapter-{chapterNumber}/
4. Create:   tmp/zip/{manga_id}-chapter-{chapterNumber}.zip
5. Upload ZIP to R2 storage
6. Delete local temporary files
7. Return public URL
```

### Notes
- Pass `chapterUrl` when images are hosted on a protected CDN that checks the `Referer` header — this is the same URL returned by [`/manga/chapter`](#get-mangachapter).
- Combine with `/manga/chapter/detail` to build a complete scrape-and-upload pipeline:
  1. `GET /manga/chapter/detail?url=<chapter_url>` → get `images` array
  2. Map `images` into `imageDataArray` with sequential `index` values
  3. `POST /uploads/chapter` → get back `publicUrl`
- To register the uploaded chapter in the database, see [`POST /admin/chapter/create/{manga_id}`](./BACKEND-API.md#post-adminchaptercreatemanga_id) in the Backend API docs.
