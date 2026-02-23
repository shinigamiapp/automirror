# Realtime Contract (Ably)

This service publishes realtime manga registry events to Ably channels.

## Auth

Request a token from:

```text
GET ${API_URL}/realtime/auth
```

Optional query:

- `manga_id`: scope token to one detail channel.

## Channels

- `manga.registry`: all manga updates
- `manga.registry.{manga_id}`: single manga updates

## Event Payload

```json
{
  "type": "manga.created",
  "manga_id": "magic-emperor",
  "data": {},
  "event_version": 1735689600000,
  "timestamp": "2026-01-01T00:00:00.000Z"
}
```

## Event Types

- `manga.created`
- `manga.updated`
- `manga.deleted`
- `manga.scan.started`
- `manga.scan.finished`
- `manga.sync.progress`
- `manga.status.changed`
