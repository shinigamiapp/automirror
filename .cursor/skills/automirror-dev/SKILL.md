---
name: automirror-dev
description: Expert developer for the automirror manga sync service. Use proactively when implementing new features, adding routes/services/workers, writing database migrations, or extending existing functionality in this codebase.
---

# Automirror Development

TypeScript manga scraping/mirroring service using Fastify, MySQL, Ably, Zod, and Vitest.

## Architecture Quick Reference

```
src/
├── routes/       # Fastify route handlers (FastifyPluginAsync)
├── schemas/      # Zod validation schemas (request/response)
├── db/
│   ├── repositories/  # Database access (raw SQL, mysql2)
│   └── migrations/    # Schema migrations
├── workers/      # Background processors (scanner, sync-processor, scheduler)
├── services/     # External integrations (scraper, uploader, realtime, cache)
├── hooks/        # Fastify hooks (auth)
├── utils/        # Shared utilities (fetch, circuit-breaker)
├── types.ts      # TypeScript interfaces
├── config.ts     # Environment configuration
└── app.ts        # Fastify app setup
```

## Adding New Features

### 1. Types First (`src/types.ts`)

```typescript
export interface NewEntity {
  id: string;
  name: string;
  status: NewEntityStatus;
  created_at: string;
  updated_at: string;
}

export type NewEntityStatus = 'active' | 'inactive' | 'pending';
```

### 2. Schema (`src/schemas/new-entity.ts`)

```typescript
import { z } from 'zod';

export const createNewEntitySchema = z.object({
  name: z.string().min(1),
  status: z.enum(['active', 'inactive', 'pending']).default('pending'),
});

export const newEntityIdParamSchema = z.object({
  id: z.string().min(1),
});

export const newEntityResponseSchema = z.object({
  id: z.string(),
  name: z.string(),
  status: z.string(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});
```

### 3. Migration (`src/db/migrations/002_new_entity.ts`)

```typescript
import type { Pool } from 'mysql2/promise';

export async function runMigrations(pool: Pool): Promise<void> {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS new_entity (
      id VARCHAR(36) NOT NULL PRIMARY KEY,
      name VARCHAR(255) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);
}
```

### 4. Repository (`src/db/repositories/new-entity.ts`)

```typescript
import { randomUUID } from 'node:crypto';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { getDatabase } from '../index.js';
import type { NewEntity } from '../../types.js';

function mysqlDateToISO(value: string | null): string | null {
  if (!value) return null;
  return new Date(value.replace(' ', 'T') + 'Z').toISOString();
}

function mapRow(row: RowDataPacket): NewEntity {
  return {
    ...row,
    created_at: mysqlDateToISO(row.created_at) ?? row.created_at,
    updated_at: mysqlDateToISO(row.updated_at) ?? row.updated_at,
  } as NewEntity;
}

export async function create(data: { name: string; status?: string }): Promise<NewEntity> {
  const db = getDatabase();
  const id = randomUUID();
  await db.execute(
    `INSERT INTO new_entity (id, name, status) VALUES (?, ?, ?)`,
    [id, data.name, data.status ?? 'pending'],
  );
  return (await getById(id))!;
}

export async function getById(id: string): Promise<NewEntity | undefined> {
  const db = getDatabase();
  const [rows] = await db.execute<RowDataPacket[]>(
    'SELECT * FROM new_entity WHERE id = ?',
    [id],
  );
  return rows[0] ? mapRow(rows[0]) : undefined;
}
```

### 5. Route (`src/routes/new-entity.ts`)

```typescript
import type { FastifyPluginAsync } from 'fastify';
import type { ZodTypeProvider } from 'fastify-type-provider-zod';
import { z } from 'zod';
import {
  createNewEntitySchema,
  newEntityIdParamSchema,
  newEntityResponseSchema,
} from '../schemas/new-entity.js';
import * as repo from '../db/repositories/new-entity.js';

export const newEntityRoutes: FastifyPluginAsync = async (fastify) => {
  const app = fastify.withTypeProvider<ZodTypeProvider>();

  app.route({
    method: 'POST',
    url: '/',
    schema: {
      tags: ['new-entity'],
      description: 'Create a new entity',
      body: createNewEntitySchema,
      response: {
        201: z.object({ success: z.literal(true), data: newEntityResponseSchema }),
      },
    },
    handler: async (request, reply) => {
      const entity = await repo.create(request.body);
      return reply.code(201).send({ success: true, data: entity });
    },
  });

  app.route({
    method: 'GET',
    url: '/:id',
    schema: {
      tags: ['new-entity'],
      params: newEntityIdParamSchema,
      response: {
        200: z.object({ success: z.literal(true), data: newEntityResponseSchema }),
        404: z.object({ success: z.literal(false), error: z.string() }),
      },
    },
    handler: async (request, reply) => {
      const entity = await repo.getById(request.params.id);
      if (!entity) {
        return reply.code(404).send({ success: false, error: 'Not found' });
      }
      return { success: true as const, data: entity };
    },
  });
};
```

### 6. Register Route (`src/app.ts`)

```typescript
import { newEntityRoutes } from './routes/new-entity.js';
// ...
app.register(newEntityRoutes, { prefix: '/new-entity' });
```

## Worker Patterns

Workers use a tick-based loop pattern:

```typescript
import type { FastifyBaseLogger } from 'fastify';
import { CONFIG } from '../config.js';

export async function workerTick(log: FastifyBaseLogger): Promise<void> {
  // 1. Query for work items
  const items = await repo.getPendingItems();
  if (items.length === 0) return;

  log.info({ count: items.length }, 'Processing items');

  // 2. Process in batches with concurrency limit
  const batch = items.slice(0, CONFIG.MAX_CONCURRENT);
  await Promise.allSettled(batch.map((item) => processItem(item, log)));
}

async function processItem(item: Item, log: FastifyBaseLogger): Promise<void> {
  try {
    await repo.updateStatus(item.id, 'processing');
    // ... do work ...
    await repo.updateStatus(item.id, 'completed');
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.error({ itemId: item.id, err: error }, 'Processing failed');
    await repo.updateStatus(item.id, 'failed', errMsg);
  }
}
```

## Service Patterns

External service integrations:

```typescript
import { CONFIG } from '../config.js';
import { fetchJson } from '../utils/fetch.js';
import type { ExternalApiResponse } from '../types.js';

export async function fetchFromExternal(id: string): Promise<ExternalApiResponse> {
  const url = `${CONFIG.EXTERNAL_API_URL}/items/${id}`;
  return fetchJson<ExternalApiResponse>(url, {
    headers: { Authorization: `Bearer ${CONFIG.EXTERNAL_API_KEY}` },
  });
}
```

## Ably Realtime Integration

### Publishing Events (`src/services/realtime.ts`)

```typescript
import Ably from 'ably';
import { CONFIG } from '../config.js';

let ablyClient: Ably.Realtime | null = null;

export function getAblyClient(): Ably.Realtime {
  if (!ablyClient) {
    ablyClient = new Ably.Realtime({ key: CONFIG.ABLY_API_KEY });
  }
  return ablyClient;
}

export async function publishEvent(
  channelName: string,
  eventName: string,
  data: Record<string, unknown>,
): Promise<void> {
  if (!CONFIG.ABLY_API_KEY) return;
  const channel = getAblyClient().channels.get(channelName);
  await channel.publish(eventName, data);
}

// Entity-specific helper
export async function publishMangaEvent(
  mangaId: string,
  eventName: string,
  data: Record<string, unknown>,
): Promise<void> {
  await publishEvent(`manga:${mangaId}`, eventName, {
    ...data,
    timestamp: Date.now(),
  });
}
```

### Event Naming Convention

- `manga.created` - New entity registered
- `manga.updated` - Settings changed
- `manga.deleted` - Entity removed
- `manga.scan.started` - Background process started
- `manga.scan.finished` - Background process completed
- `manga.sync.progress` - Progress update during sync
- `manga.sync.chapter.completed` - Individual item processed

### Publishing Pattern (Non-Blocking)

Always publish events non-blocking to avoid delaying API responses:

```typescript
// In route handlers
publishMangaEvent(manga.manga_id, 'manga.created', {
  id: manga.id,
  series_title: manga.series_title,
  status: manga.status,
}).catch(() => {}); // Fire-and-forget

return reply.code(201).send({ success: true, data: manga });
```

### Channel Structure

- Per-entity channels: `manga:{manga_id}` - subscribe to specific manga updates
- Global channels: `manga:all` - subscribe to all manga events
- User channels: `user:{user_id}` - user-specific notifications

## Key Conventions

| Area | Convention |
|------|------------|
| IDs | UUIDs via `randomUUID()` |
| Dates | Store as MySQL DATETIME, return as ISO strings |
| Responses | `{ success: true, data: ... }` or `{ success: false, error: '...' }` |
| Status codes | 201 created, 200 ok, 404 not found, 409 conflict, 400 bad request |
| Logging | Use `request.log` in routes, pass `log` param to workers |
| Background ops | `.catch(() => {})` for fire-and-forget |
| Transactions | Use `connection.beginTransaction()` with try/catch/finally |

## Config Pattern (`src/config.ts`)

```typescript
export const CONFIG = {
  // Required
  DATABASE_URL: process.env.DATABASE_URL!,
  
  // Optional with defaults
  PORT: parseInt(process.env.PORT ?? '3000', 10),
  MAX_CONCURRENT: parseInt(process.env.MAX_CONCURRENT ?? '5', 10),
  
  // Feature flags
  ABLY_API_KEY: process.env.ABLY_API_KEY ?? '',
} as const;
```

## Common Queries

### Pagination

```typescript
const normalizedPage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
const normalizedPageSize = Number.isFinite(pageSize) && pageSize > 0
  ? Math.min(Math.floor(pageSize), 100)
  : 20;
const offset = (normalizedPage - 1) * normalizedPageSize;

const [rows] = await db.execute<RowDataPacket[]>(
  `SELECT * FROM table ORDER BY created_at DESC LIMIT ${normalizedPageSize} OFFSET ${offset}`,
);
```

### Dynamic WHERE clauses

```typescript
const whereClauses: string[] = [];
const params: (string | number)[] = [];

if (status) {
  whereClauses.push('status = ?');
  params.push(status);
}

const whereClause = whereClauses.length > 0
  ? `WHERE ${whereClauses.join(' AND ')}`
  : '';

const [rows] = await db.execute<RowDataPacket[]>(
  `SELECT * FROM table ${whereClause}`,
  params,
);
```
