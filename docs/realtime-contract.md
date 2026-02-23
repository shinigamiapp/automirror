# Realtime Contract

This document describes the Ably realtime integration for live manga updates.

## Authentication

### GET /realtime/auth

Get an Ably token request for frontend authentication.

**Query Parameters:**

| Parameter  | Type   | Required | Description                                      |
| ---------- | ------ | -------- | ------------------------------------------------ |
| `manga_id` | string | No       | Scope token to a specific manga's detail channel |

**Response (200):**

```json
{
  "success": true,
  "data": {
    "tokenRequest": { /* Ably TokenRequest object */ }
  }
}
```

**Response (503):** Ably not configured

```json
{
  "success": false,
  "error": "Realtime service is not configured"
}
```

### GET /realtime/status

Check if realtime is configured.

**Response:**

```json
{
  "configured": true
}
```

---

## Channel Naming

| Channel                        | Description                         |
| ------------------------------ | ----------------------------------- |
| `manga:list`                   | All manga list updates              |
| `manga:detail:{manga_id}`      | Updates for a specific manga        |

The prefix (`manga`) is configurable via `ABLY_CHANNEL_PREFIX` env var.

---

## Event Types

### manga.created

Published when a new manga is registered.

**Channels:** `manga:list`, `manga:detail:{manga_id}`

**Payload:**

```json
{
  "manga_id": "d318686b-44be-430f-a853-0b3cc8bda228",
  "id": "registry-uuid",
  "series_title": "One Piece",
  "status": "idle"
}
```

### manga.updated

Published when manga settings are updated.

**Channels:** `manga:list`, `manga:detail:{manga_id}`

**Payload:**

```json
{
  "manga_id": "d318686b-44be-430f-a853-0b3cc8bda228",
  "id": "registry-uuid",
  "series_title": "One Piece",
  "status": "idle",
  "auto_sync_enabled": 1
}
```

### manga.deleted

Published when a manga is removed from registry.

**Channels:** `manga:list`, `manga:detail:{manga_id}`

**Payload:**

```json
{
  "manga_id": "d318686b-44be-430f-a853-0b3cc8bda228",
  "id": "registry-uuid",
  "series_title": "One Piece"
}
```

### manga.scan.started

Published when a manga scan begins.

**Channels:** `manga:list`, `manga:detail:{manga_id}`

**Payload:**

```json
{
  "manga_id": "d318686b-44be-430f-a853-0b3cc8bda228",
  "id": "registry-uuid",
  "series_title": "One Piece",
  "status": "scanning"
}
```

### manga.scan.finished

Published when a manga scan completes (success or error).

**Channels:** `manga:list`, `manga:detail:{manga_id}`

**Payload (success):**

```json
{
  "manga_id": "d318686b-44be-430f-a853-0b3cc8bda228",
  "id": "registry-uuid",
  "series_title": "One Piece",
  "status": "syncing",
  "source_chapter_count": 1089,
  "source_last_chapter": 1089,
  "missing_chapters": 3
}
```

**Payload (error):**

```json
{
  "manga_id": "d318686b-44be-430f-a853-0b3cc8bda228",
  "id": "registry-uuid",
  "series_title": "One Piece",
  "status": "error",
  "error": "Failed to fetch chapter list"
}
```

### manga.sync.progress

Published after each chapter sync completes or fails.

**Channels:** `manga:list`, `manga:detail:{manga_id}`

**Payload (completed):**

```json
{
  "manga_id": "d318686b-44be-430f-a853-0b3cc8bda228",
  "id": "registry-uuid",
  "chapter_number": 1089,
  "status": "completed"
}
```

**Payload (failed):**

```json
{
  "manga_id": "d318686b-44be-430f-a853-0b3cc8bda228",
  "id": "registry-uuid",
  "chapter_number": 1089,
  "status": "failed",
  "error": "No images found for chapter"
}
```

---

## Frontend Integration

### Installation

```bash
npm install ably
```

### Usage Example (React)

```typescript
import Ably from 'ably';
import { useEffect, useState } from 'react';

const API_URL = 'https://your-api.example.com';

// Create Ably client with token auth
const ably = new Ably.Realtime({
  authCallback: async (tokenParams, callback) => {
    try {
      const res = await fetch(`${API_URL}/realtime/auth`);
      const json = await res.json();
      if (json.success) {
        callback(null, json.data.tokenRequest);
      } else {
        callback(new Error(json.error), null);
      }
    } catch (err) {
      callback(err as Error, null);
    }
  },
});

// Hook to subscribe to manga list updates
export function useMangaListUpdates(onEvent: (event: string, data: any) => void) {
  useEffect(() => {
    const channel = ably.channels.get('manga:list');

    const listener = (message: Ably.Message) => {
      onEvent(message.name, message.data);
    };

    channel.subscribe(listener);

    return () => {
      channel.unsubscribe(listener);
    };
  }, [onEvent]);
}

// Hook to subscribe to specific manga updates
export function useMangaDetailUpdates(
  mangaId: string,
  onEvent: (event: string, data: any) => void,
) {
  useEffect(() => {
    const channel = ably.channels.get(`manga:detail:${mangaId}`);

    const listener = (message: Ably.Message) => {
      onEvent(message.name, message.data);
    };

    channel.subscribe(listener);

    return () => {
      channel.unsubscribe(listener);
    };
  }, [mangaId, onEvent]);
}

// Example component
function MangaList() {
  const [manga, setManga] = useState<any[]>([]);

  useMangaListUpdates((event, data) => {
    console.log('Received event:', event, data);

    switch (event) {
      case 'manga.created':
        // Refresh list or add to state
        break;
      case 'manga.scan.finished':
        // Update manga status in list
        break;
      case 'manga.sync.progress':
        // Update sync progress indicator
        break;
    }
  });

  return <div>{/* render manga list */}</div>;
}
```

### Scoped Token (Single Manga)

For detail pages, request a scoped token to limit access:

```typescript
const res = await fetch(`${API_URL}/realtime/auth?manga_id=${mangaId}`);
```

This returns a token that only has access to `manga:detail:{manga_id}`.
