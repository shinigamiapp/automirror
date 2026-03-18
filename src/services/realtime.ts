import Ably from 'ably';
import { CONFIG } from '../config.js';
import type { MangaRegistry } from '../types.js';

// Lazy-initialized Ably client
let ablyClient: Ably.Rest | null = null;

/**
 * Check if Ably realtime is configured.
 */
export function isRealtimeConfigured(): boolean {
  return Boolean(CONFIG.ABLY_API_KEY);
}

/**
 * Get or create the Ably client instance.
 */
function getClient(): Ably.Rest | null {
  if (!isRealtimeConfigured()) {
    return null;
  }

  if (!ablyClient) {
    ablyClient = new Ably.Rest({ key: CONFIG.ABLY_API_KEY });
  }

  return ablyClient;
}

/**
 * Get channel name for the manga list.
 */
function getListChannel(): string {
  return `${CONFIG.ABLY_CHANNEL_PREFIX}:list`;
}

/**
 * Get channel name for a specific manga detail.
 */
function getDetailChannel(mangaId: string): string {
  return `${CONFIG.ABLY_CHANNEL_PREFIX}:detail:${mangaId}`;
}

/**
 * Publish an event to the list channel.
 */
export async function publishToList(
  event: string,
  data: Record<string, unknown>,
): Promise<void> {
  const client = getClient();
  if (!client) return;

  try {
    const channel = client.channels.get(getListChannel());
    await channel.publish(event, data);
  } catch (error) {
    console.error('[Realtime] Failed to publish to list channel:', error);
  }
}

/**
 * Publish an event to a manga detail channel.
 */
export async function publishToDetail(
  mangaId: string,
  event: string,
  data: Record<string, unknown>,
): Promise<void> {
  const client = getClient();
  if (!client) return;

  try {
    const channel = client.channels.get(getDetailChannel(mangaId));
    await channel.publish(event, data);
  } catch (error) {
    console.error(`[Realtime] Failed to publish to detail channel (${mangaId}):`, error);
  }
}

/**
 * Publish an event to both list and detail channels.
 */
export async function publishMangaEvent(
  mangaId: string,
  event: string,
  data: Record<string, unknown>,
): Promise<void> {
  await Promise.all([
    publishToList(event, { ...data, manga_id: mangaId }),
    publishToDetail(mangaId, event, data),
  ]);
}

/**
 * Convert a MangaRegistry to a realtime payload with all list-relevant fields.
 * This ensures consistent, enriched payloads across all events.
 */
export function toRealtimePayload(manga: MangaRegistry): Record<string, unknown> {
  return {
    id: manga.id,
    manga_id: manga.manga_id,
    series_title: manga.series_title,
    source_domain: manga.source_domain,
    status: manga.status,
    auto_sync_enabled: manga.auto_sync_enabled,
    source_chapter_count: manga.source_chapter_count,
    source_last_chapter: manga.source_last_chapter,
    backend_chapter_count: manga.backend_chapter_count,
    backend_last_chapter: manga.backend_last_chapter,
    sync_progress_total: manga.sync_progress_total,
    sync_progress_completed: manga.sync_progress_completed,
    sync_progress_failed: manga.sync_progress_failed,
    last_scanned_at: manga.last_scanned_at,
    last_synced_at: manga.last_synced_at,
    next_scan_at: manga.next_scan_at,
    last_error: manga.last_error,
    consecutive_failures: manga.consecutive_failures,
    updated_at: manga.updated_at,
  };
}

/**
 * Create an Ably token request for frontend authentication.
 * If mangaId is provided, scopes to that detail channel only.
 * Otherwise grants access to list + all detail channels.
 */
export async function createTokenRequest(
  mangaId?: string,
): Promise<Ably.TokenRequest> {
  const client = getClient();
  if (!client) {
    throw new Error('Ably is not configured');
  }

  type CapabilityOp = 'subscribe' | 'history' | 'publish' | 'presence';
  const capability: Record<string, CapabilityOp[]> = {};

  if (mangaId) {
    // Scoped to specific manga detail channel
    capability[getDetailChannel(mangaId)] = ['subscribe', 'history'];
  } else {
    // Full access to list and all detail channels
    capability[getListChannel()] = ['subscribe', 'history'];
    capability[`${CONFIG.ABLY_CHANNEL_PREFIX}:detail:*`] = ['subscribe', 'history'];
  }

  return client.auth.createTokenRequest({
    capability: capability as { [key: string]: CapabilityOp[] | ['*'] },
  });
}
