import * as Ably from 'ably';
import { CONFIG } from '../config.js';

let ablyClient: Ably.Rest | null = null;

function getAbly(): Ably.Rest {
  if (!ablyClient && CONFIG.ABLY_API_KEY) {
    ablyClient = new Ably.Rest({ key: CONFIG.ABLY_API_KEY });
  }
  if (!ablyClient) {
    throw new Error('Ably not configured');
  }
  return ablyClient;
}

export function isRealtimeConfigured(): boolean {
  return CONFIG.ABLY_API_KEY.length > 0;
}

export type MangaEventType =
  | 'manga.created'
  | 'manga.updated'
  | 'manga.deleted'
  | 'manga.scan.started'
  | 'manga.scan.finished'
  | 'manga.sync.progress'
  | 'manga.status.changed';

export interface MangaEvent {
  type: MangaEventType;
  manga_id: string;
  data: Record<string, unknown>;
  event_version: number;
  timestamp: string;
}

export async function publishToList(event: MangaEvent): Promise<void> {
  if (!isRealtimeConfigured()) return;
  const channel = getAbly().channels.get(`${CONFIG.ABLY_CHANNEL_PREFIX}.registry`);
  await channel.publish(event.type, event);
}

export async function publishToDetail(mangaId: string, event: MangaEvent): Promise<void> {
  if (!isRealtimeConfigured()) return;
  const channel = getAbly().channels.get(`${CONFIG.ABLY_CHANNEL_PREFIX}.registry.${mangaId}`);
  await channel.publish(event.type, event);
}

export async function publishMangaEvent(event: MangaEvent): Promise<void> {
  if (!isRealtimeConfigured()) return;
  await Promise.all([
    publishToList(event),
    publishToDetail(event.manga_id, event),
  ]);
}

export async function createTokenRequest(
  clientId: string,
  capabilities: Record<string, string[]>,
): Promise<unknown> {
  return getAbly().auth.createTokenRequest({
    clientId,
    capability: JSON.stringify(capabilities),
    ttl: 3_600_000,
  });
}
