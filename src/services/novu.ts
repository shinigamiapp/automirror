import { CONFIG } from '../config.js';
import { fetchWithTimeout } from '../utils/fetch.js';
import type { MangaRegistry, MangaSyncTask } from '../types.js';

/** Per-manga last-notification timestamp to enforce cooldown */
const lastNotified = new Map<string, number>();

export type FailureType = 'scan_failed' | 'sync_failed' | 'max_retries_exceeded';

export interface NovuNotifyOptions {
  failureType: FailureType;
  errorMessage: string;
  failedTasks?: Pick<MangaSyncTask, 'chapter_number' | 'chapter_url' | 'error' | 'retry_count'>[];
}

/**
 * Notify via Novu when a manga sync fails.
 * - Respects per-manga cooldown to avoid notification spam.
 * - Catches all errors: notification failure MUST NOT break sync flow.
 */
export async function notifyMangaSyncFailed(
  manga: MangaRegistry,
  options: NovuNotifyOptions,
): Promise<void> {
  if (!CONFIG.NOVU_API_KEY || !CONFIG.NOVU_SUBSCRIBER_ID) return;

  // Only notify after threshold
  if (manga.consecutive_failures < CONFIG.NOTIFY_AFTER_FAILURES) return;

  // Cooldown check
  const now = Date.now();
  const lastTime = lastNotified.get(manga.id);
  if (lastTime && now - lastTime < CONFIG.NOTIFICATION_COOLDOWN_MS) return;

  try {
    const payload = {
      manga_id: manga.manga_id,
      series_title: manga.series_title,
      failure_type: options.failureType,
      error_message: options.errorMessage,
      consecutive_failures: manga.consecutive_failures,
      source_chapter_count: manga.source_chapter_count,
      backend_chapter_count: manga.backend_chapter_count,
      sync_progress: {
        total: manga.sync_progress_total,
        completed: manga.sync_progress_completed,
        failed: manga.sync_progress_failed,
      },
      // Only send first 5 failed tasks to keep payload small
      failed_tasks: (options.failedTasks ?? []).slice(0, 5).map((t) => ({
        chapter_number: t.chapter_number,
        chapter_url: t.chapter_url,
        error: t.error,
        retry_count: t.retry_count,
      })),
      dashboard_url: `${CONFIG.DASHBOARD_URL}/scraper/manga/${manga.id}`,
      retry_url: `${CONFIG.API_URL}/manga/${manga.id}/retry`,
    };

    await fetchWithTimeout(`https://api.novu.co/v1/events/trigger`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `ApiKey ${CONFIG.NOVU_API_KEY}`,
      },
      body: JSON.stringify({
        name: 'manga-sync-failed',
        to: { subscriberId: CONFIG.NOVU_SUBSCRIBER_ID },
        payload,
      }),
      timeoutMs: 10_000,
    });

    lastNotified.set(manga.id, now);
  } catch (err) {
    // Intentionally silenced — notification errors must never break sync
    console.error('[novu] Failed to send notification:', err);
  }
}
