# POST /v1/upload/single

Uploads a single manga chapter from a ZIP file to B2 storage. Blocks until processing is
complete and returns the result directly.

---

## Authentication

One of the following headers is required.

### Clerk JWT

```
Authorization: Bearer <token>
```

The token must be issued by the configured Clerk issuer and contain an `o` claim with:

- `id` matching `CLERK_ORG_ID`
- `rol` of `"admin"` or `"member"`

### API Key *(service-to-service)*

```
X-API-Key: <key>
```

Matches the `API_KEY` environment variable. Bypasses Clerk entirely — treated as `admin`.
Use this for internal service calls where a Clerk JWT is unavailable.

### Auth Error Responses

| HTTP | Body | Cause |
|------|------|-------|
| `401` | `{"error":"Missing or invalid authorization header"}` | No auth header |
| `401` | `{"error":"Token expired","code":"TOKEN_EXPIRED"}` | JWT expired |
| `401` | `{"error":"Invalid token signature","code":"INVALID_SIGNATURE"}` | Tampered JWT |
| `401` | `{"error":"Invalid token (no matching key)","code":"NO_MATCHING_KEY"}` | Key ID mismatch |
| `401` | `{"error":"Authentication failed","code":"AUTH_FAILED"}` | Other JWT error |
| `401` | `{"error":"API key authentication not configured"}` | `X-API-Key` sent but `API_KEY` env not set |
| `401` | `{"error":"Invalid API key"}` | Wrong key value |
| `403` | `{"error":"Organization membership required"}` | JWT missing `o` claim |
| `403` | `{"error":"Invalid organization"}` | Wrong org ID in JWT |
| `403` | `{"error":"Insufficient permissions. Required roles: admin or member"}` | Role not allowed |
| `503` | `{"error":"Auth service temporarily unavailable, please retry","code":"JWKS_TIMEOUT"}` | JWKS endpoint unreachable |

---

## Request

**Method:** `POST`  
**Path:** `/v1/upload/single`  
**Content-Type:** `application/json`

| Field | Type | Constraints | Description |
|-------|------|-------------|-------------|
| `zip_url` | string | Valid URI, required | URL to download the ZIP from |
| `manga_id` | string | UUID v4, required | Target manga |
| `chapter_number` | number | ≥ 0, required | Chapter number (decimals like `1.5` are valid) |

### Example — Clerk JWT

```bash
curl -X POST https://uploader.example.com/v1/upload/single \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "zip_url": "https://storage.example.com/zips/chapter-1.zip",
    "manga_id": "123e4567-e89b-12d3-a456-426614174000",
    "chapter_number": 1
  }'
```

### Example — API Key

```bash
curl -X POST https://uploader.example.com/v1/upload/single \
  -H "X-API-Key: $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "zip_url": "https://storage.example.com/zips/chapter-1.zip",
    "manga_id": "123e4567-e89b-12d3-a456-426614174000",
    "chapter_number": 1
  }'
```

---

## Processing Pipeline

1. Validate request body with Joi.
2. Check whether the chapter already exists in the database.
   - **Exists with stored images** → delete old B2 objects, then upload new ones (implicit replace, same `chapter_id` reused).
   - **Does not exist** → generate a new `chapter_id` and create a new record.
3. Download `zip_url` to a temp file on disk (streamed — not loaded into memory).
4. Scan all ZIP entries; collect files with a supported image extension, ignoring system artifacts.
5. Validate each image buffer with Sharp; silently skip entries that fail decoding.
6. JPEG images without an alpha channel are re-encoded at mozjpeg quality 90. All other formats (PNG, WebP, GIF) are stored as-is.
7. Rename each file to `{original_basename}-{4-char-md5-hash}{ext}`.
8. Upload all images concurrently to B2 (up to **15** simultaneous uploads).
9. Sort the final image list with natural sort.
10. Ensure manga row exists (`INSERT IGNORE`) and upsert the chapter row.
11. Delete the temp ZIP file (always, even on error).

---

## Responses

### 200 — New chapter created

```json
{
  "message": "Files extracted successfully",
  "results": {
    "manga_id": "123e4567-e89b-12d3-a456-426614174000",
    "chapter_number": "1",
    "chapter_id": "987fcdeb-51a2-3b4c-d5e6-789012345678",
    "data": [
      "001-a1b2.jpg",
      "002-c3d4.jpg",
      "003-e5f6.png"
    ],
    "path": "/chapter/manga_123e4567-e89b-12d3-a456-426614174000/chapter_987fcdeb-51a2-3b4c-d5e6-789012345678/"
  }
}
```

### 200 — Chapter already existed (implicit replace)

```json
{
  "message": "Chapter replaced successfully",
  "results": {
    "manga_id": "123e4567-e89b-12d3-a456-426614174000",
    "chapter_number": "1",
    "chapter_id": "987fcdeb-51a2-3b4c-d5e6-789012345678",
    "data": [
      "001-a1b2.jpg",
      "002-c3d4.jpg"
    ],
    "path": "/chapter/manga_123e4567-e89b-12d3-a456-426614174000/chapter_987fcdeb-51a2-3b4c-d5e6-789012345678/"
  },
  "info": [
    {
      "type": "chapter_replaced",
      "message": "Existing chapter was replaced with new content"
    }
  ]
}
```

### Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `message` | string | `"Files extracted successfully"` (new) or `"Chapter replaced successfully"` (replaced) |
| `results.manga_id` | string | UUID of the manga |
| `results.chapter_number` | string | Chapter number as string (e.g. `"1"`, `"1.5"`) |
| `results.chapter_id` | string | UUID of the chapter (new or reused) |
| `results.data` | string[] | Hashed image filenames, natural-sort ordered |
| `results.path` | string | B2 key prefix path (leading and trailing `/` included) |
| `info` | array \| absent | Only present when an existing chapter was replaced |

> **Path format:** `/{B2_PREFIX}/chapter/manga_{manga_id}/chapter_{chapter_id}/`  
> When `B2_PREFIX` is empty: `/chapter/manga_{manga_id}/chapter_{chapter_id}/`

---

## ZIP Requirements

Images are found at **any depth** within the ZIP — no specific folder structure is required.

### Supported extensions

| Extension | MIME stored in B2 |
|-----------|-------------------|
| `.jpg` / `.jpeg` | `image/jpeg` |
| `.png` | `image/png` |
| `.webp` | `image/webp` |
| `.gif` | `image/gif` |

### Silently ignored paths

| Pattern | Reason |
|---------|--------|
| Contains `__MACOSX/` | macOS metadata folder |
| Contains `.ds_store` | macOS desktop services store |
| Contains `thumbs.db` | Windows thumbnail cache |
| Filename starts with `._` | macOS resource fork |

---

## Error Responses

All errors use the shape `{ "error": "<message>" }`.

### 400 — Validation (first failing field only)

```json
{ "error": "\"zip_url\" must be a valid uri" }
{ "error": "\"manga_id\" must be a valid GUID" }
{ "error": "\"chapter_number\" must be a number" }
{ "error": "\"chapter_number\" must be greater than or equal to 0" }
{ "error": "\"zip_url\" is required" }
{ "error": "\"manga_id\" is required" }
{ "error": "\"chapter_number\" is required" }
```

### 400 — Processing

```json
{ "error": "No valid images found in the zip" }
{ "error": "Failed to download ZIP: HTTP 403" }
```

### 500 — Unexpected

```json
{ "error": "Internal server error" }
```

Internal details are logged via Winston but never sent to the client.

---

## Network Timeouts

| Phase | Timeout |
|-------|---------|
| ZIP download headers | 30 s |
| ZIP download body | 5 min |

For large ZIPs or slow sources, consider using `/v1/upload/single/async` to avoid gateway
timeouts on the client connection.

---

## Notes

- `chapter_number` `0` is valid (prologue chapters).
- `results.chapter_number` is always returned as a **string**.
- Calling the endpoint twice on the same chapter replaces it the second time — no extra flag needed.
- The temp ZIP is always cleaned up from disk, even if processing fails.
