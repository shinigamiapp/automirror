import Ably from 'ably';
import { CONFIG } from '../config.js';

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

  const capability: Record<string, string[]> = {};

  if (mangaId) {
    // Scoped to specific manga detail channel
    capability[getDetailChannel(mangaId)] = ['subscribe', 'history'];
  } else {
    // Full access to list and all detail channels
    capability[getListChannel()] = ['subscribe', 'history'];
    capability[`${CONFIG.ABLY_CHANNEL_PREFIX}:detail:*`] = ['subscribe', 'history'];
  }

  return client.auth.createTokenRequest({ capability });
}
