import type { FastifyBaseLogger } from 'fastify';
import { CONFIG } from '../config.js';
import * as mangaRepo from '../db/repositories/manga.js';
import * as scraperService from '../services/scraper.js';
import * as uploaderService from '../services/uploader.js';
import * as backendService from '../services/backend.js';
import { debouncedCachePurge } from '../services/cache.js';
import type { MangaRegistry, MangaSyncTask } from '../types.js';

/**
 * Process a single sync task through the 4-step flow:
 *
 * 1. GET /manga/chapter/detail — get images[]
 * 2. POST /uploads/chapter (Scraper API) — download images, create ZIP, upload to R2
 * 3. POST /v1/upload/single (Uploader API) — upload ZIP to B2 storage
 * 4. POST /admin/chapter/create/{manga_id} (Backend API) — register chapter
 */
async function processTask(
  manga: MangaRegistry,
  task: MangaSyncTask,
  log: FastifyBaseLogger,
): Promise<void> {
  const taskLog = log.child({
    mangaId: manga.manga_id,
    chapter: task.chapter_number,
    taskId: task.id,
  });

  try {
    // Step 1: Get chapter images
    taskLog.info('Step 1: Fetching chapter images');
    await mangaRepo.updateSyncTaskStatus(task.id, 'scraping');

    const chapterDetail = await scraperService.getChapterDetail(task.chapter_url);

    // chapterDetail is an array of { index, download_url }
    if (!Array.isArray(chapterDetail) || chapterDetail.length === 0) {
      throw new Error('No images found for chapter');
    }

    // Step 2: Create ZIP from images via Scraper API
    taskLog.info({ imageCount: chapterDetail.length }, 'Step 2: Creating ZIP');

    // chapterDetail already has the correct format: { index, download_url }[]
    const imageDataArray = chapterDetail;

    const uploadResult = await scraperService.uploadChapter({
      imageDataArray,
      manga_id: manga.manga_id,
      chapterNumber: String(task.chapter_number),
      seriesTitle: manga.series_title,
      chapterUrl: task.chapter_url,
    });

    if (!uploadResult.success || !uploadResult.data?.publicUrl) {
      throw new Error('Failed to create ZIP: ' + (uploadResult.message || 'Unknown error'));
    }

    const zipUrl = uploadResult.data.publicUrl;
    await mangaRepo.updateSyncTaskStatus(task.id, 'scraped', { zip_url: zipUrl });

    // Step 3: Upload ZIP to B2 via Uploader API
    taskLog.info({ zipUrl }, 'Step 3: Uploading to B2');
    await mangaRepo.updateSyncTaskStatus(task.id, 'uploading');

    const uploaderResult = await uploaderService.uploadSingle({
      zip_url: zipUrl,
      manga_id: manga.manga_id,
      chapter_number: task.chapter_number,
    });

    // Step 4: Create chapter in Backend
    taskLog.info('Step 4: Creating chapter in backend');

    await backendService.createChapters(manga.manga_id, [
      {
        chapter_id: uploaderResult.results.chapter_id,
        chapter_number: task.chapter_number,
        chapter_title: '',
        chapter_images: uploaderResult.results.data,
        path: uploaderResult.results.path,
        thumbnail_image_url: CONFIG.DEFAULT_THUMBNAIL_URL,
      },
    ]);

    await mangaRepo.incrementBackendChapterStats(manga.id, task.chapter_number);

    // Mark completed
    await mangaRepo.updateSyncTaskStatus(task.id, 'completed');
    await mangaRepo.updateMangaSyncProgress(manga.id);
    debouncedCachePurge(manga.manga_id);

    taskLog.info('Chapter synced successfully');
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    taskLog.error({ err: error }, 'Task failed');

    await mangaRepo.updateSyncTaskStatus(task.id, 'failed', { error: errMsg });
    await mangaRepo.updateMangaSyncProgress(manga.id);
  }
}

/**
 * Process pending tasks for a single manga.
 */
async function processManga(
  manga: MangaRegistry,
  log: FastifyBaseLogger,
): Promise<void> {
  const pendingTasks = await mangaRepo.getPendingSyncTasks(
    manga.id,
    CONFIG.DEFAULT_CHAPTERS_PER_MANGA,
  );

  log.info({ mangaId: manga.manga_id, pendingCount: pendingTasks.length }, 'Processing manga tasks');

  if (pendingTasks.length === 0) {
    // Check if all tasks are done
    const allTasks = await mangaRepo.getSyncTasksByManga(manga.id);
    const hasActive = allTasks.some((t) =>
      ['pending', 'scraping', 'scraped', 'uploading'].includes(t.status),
    );

    if (!hasActive) {
      const hasFailed = allTasks.some((t) => t.status === 'failed');
      await mangaRepo.updateMangaStatus(
        manga.id,
        hasFailed ? 'error' : 'idle',
        hasFailed ? 'Some chapters failed to sync' : undefined,
      );

      if (!hasFailed) {
        await mangaRepo.updateLastSyncedAt(manga.id);
      }
    }
    return;
  }

  // Process tasks sequentially to respect rate limits
  for (const task of pendingTasks) {
    await processTask(manga, task, log);
  }
}

/**
 * Sync processor tick — processes pending sync tasks for all active manga.
 */
export async function syncProcessorTick(log: FastifyBaseLogger): Promise<void> {
  // Resolve manga stuck in 'syncing' after all their tasks have finished.
  // This runs every tick to catch any that slipped through (e.g. race conditions).
  const resolved = await mangaRepo.resolveCompletedSyncingManga();
  if (resolved > 0) {
    log.info({ resolved }, 'Resolved stuck syncing manga');
  }

  const activeManga = await mangaRepo.getMangaWithActiveTasks();
  if (activeManga.length === 0) return;

  log.info({ count: activeManga.length }, 'Processing active manga syncs');

  // Process manga concurrently up to limit
  const batch = activeManga.slice(0, CONFIG.MAX_CONCURRENT_SYNCS);

  const results = await Promise.allSettled(
    batch.map((manga) => processManga(manga, log)),
  );

  // Log any rejected promises
  for (const [index, result] of results.entries()) {
    if (result.status === 'rejected') {
      log.error({ mangaId: batch[index].manga_id, error: result.reason }, 'processManga failed');
    }
  }
}
