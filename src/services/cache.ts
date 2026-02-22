import { CONFIG } from '../config.js';
import { fetchWithTimeout } from '../utils/fetch.js';

let flushScheduled = false;

/**
 * Debounced cache purge — schedules a single tag-based purge after the current
 * event-loop turn. This prevents a flood of purge calls when many chapters
 * complete in one worker tick.
 */
export function debouncedCachePurge(_mangaId?: string): void {
  if (!flushScheduled) {
    flushScheduled = true;
    // Defer until after current synchronous work completes
    setImmediate(flushPurges);
  }
}

async function flushPurges(): Promise<void> {
  flushScheduled = false;
  await purgeCache(['manga', 'chapter']);
}

/**
 * Purge cache by tags.
 * Errors are swallowed — cache purge failure must not break the sync flow.
 */
export async function purgeCache(tags: string[]): Promise<void> {
  if (!CONFIG.CACHE_PURGE_URL || !CONFIG.CACHE_PURGE_API_KEY) return;

  try {
    await fetchWithTimeout(`${CONFIG.CACHE_PURGE_URL}/cache/purge/tag`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': CONFIG.CACHE_PURGE_API_KEY,
      },
      body: JSON.stringify({ tags }),
      timeoutMs: 10_000,
    });
  } catch {
    // Intentionally silenced — cache purge failure must not break sync flow
  }
}

/**
 * @deprecated Use purgeCache(['manga', 'chapter']) or debouncedCachePurge() instead.
 * Kept for backward compatibility — now just triggers tag-based purge.
 */
export async function purgeMangaCache(_mangaId: string): Promise<void> {
  await purgeCache(['manga', 'chapter']);
}
