import type { FastifyBaseLogger } from 'fastify';
import { CONFIG } from '../config.js';
import * as mangaRepo from '../db/repositories/manga.js';
import * as scraperService from '../services/scraper.js';
import * as backendService from '../services/backend.js';
import type { MangaRegistry, ScraperChapterListItem } from '../types.js';

/**
 * Parse chapter number from a chapter title/url string.
 * e.g. "Chapter 26" -> 26, "Chapter 26.5" -> 26.5
 */
function parseChapterNumber(title: string): number {
  const match = title.match(/(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : 0;
}

/**
 * Scanner worker — checks for new chapters using metadata-first optimization.
 *
 * Flow:
 * 1. Quick metadata check (GET /manga/detail) — O(1)
 * 2. If no new chapters → skip, just update next_scan_at
 * 3. If new chapters → fetch full chapter list + backend chapters
 * 4. Create sync tasks for missing chapters
 */
export async function scanManga(
  manga: MangaRegistry,
  log: FastifyBaseLogger,
): Promise<void> {
  log.info({ mangaId: manga.manga_id, title: manga.series_title }, 'Scanning manga');

  await mangaRepo.updateMangaStatus(manga.id, 'scanning');

  try {
    // Step 1: Quick metadata check
    const detail = await scraperService.getMangaDetail(manga.manga_url);
    const sourceLastChapter = detail.chapterSummary.lastChapter.number;
    const sourceTotal = detail.chapterSummary.total;

    // Step 2: Skip if no new chapters
    if (
      manga.source_last_chapter !== null &&
      sourceLastChapter <= manga.source_last_chapter
    ) {
      log.info(
        { mangaId: manga.manga_id, lastChapter: sourceLastChapter },
        'No new chapters found, skipping full scan',
      );

      const nextScan = new Date(
        Date.now() + manga.check_interval_minutes * 60_000,
      ).toISOString();

      await mangaRepo.updateMangaScanResult(manga.id, {
        source_chapter_count: sourceTotal,
        source_last_chapter: sourceLastChapter,
        next_scan_at: nextScan,
      });
      return;
    }

    log.info(
      {
        mangaId: manga.manga_id,
        sourceLastChapter,
        knownLastChapter: manga.source_last_chapter,
      },
      'New chapters detected, fetching full chapter list',
    );

    // Step 3: Fetch full chapter list from source
    const sourceChapters = await scraperService.getAllChapters(manga.manga_url);

    // Fetch all existing backend chapters
    const existingChapterNumbers = await backendService.getAllChapterNumbers(manga.manga_id);

    // Step 4: Find missing chapters
    const missingChapters = sourceChapters.filter((ch) => {
      const num = parseChapterNumber(ch.title);
      return num > 0 && !existingChapterNumbers.has(num);
    });

    if (missingChapters.length === 0) {
      log.info({ mangaId: manga.manga_id }, 'All chapters already synced');

      const nextScan = new Date(
        Date.now() + manga.check_interval_minutes * 60_000,
      ).toISOString();

      await mangaRepo.updateMangaScanResult(manga.id, {
        source_chapter_count: sourceTotal,
        source_last_chapter: sourceLastChapter,
        next_scan_at: nextScan,
      });
      return;
    }

    log.info(
      { mangaId: manga.manga_id, missing: missingChapters.length },
      'Creating sync tasks for missing chapters',
    );

    // Create sync tasks
    await mangaRepo.createSyncTasks(
      manga.id,
      missingChapters.map((ch: ScraperChapterListItem, index: number) => ({
        chapter_url: ch.url,
        chapter_number: parseChapterNumber(ch.title),
        weight: index,
      })),
    );

    // Update manga state
    const nextScan = new Date(
      Date.now() + manga.check_interval_minutes * 60_000,
    ).toISOString();

    await mangaRepo.updateMangaScanResult(manga.id, {
      source_chapter_count: sourceTotal,
      source_last_chapter: sourceLastChapter,
      next_scan_at: nextScan,
    });

    // Transition to syncing
    await mangaRepo.updateMangaStatus(manga.id, 'syncing');

    // Update progress totals
    await mangaRepo.incrementSyncProgressTotal(manga.id, missingChapters.length);
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.error({ mangaId: manga.manga_id, err: error }, 'Scan failed');
    await mangaRepo.updateMangaStatus(manga.id, 'error', errMsg);
  }
}

/**
 * Scanner tick — processes all due manga scans.
 */
export async function scannerTick(log: FastifyBaseLogger): Promise<void> {
  const dueManga = await mangaRepo.getDueManga();
  if (dueManga.length === 0) return;

  log.info({ count: dueManga.length }, 'Processing due manga scans');

  // Process in batches respecting concurrency limit
  const batch = dueManga.slice(0, CONFIG.MAX_CONCURRENT_SCANS);

  await Promise.allSettled(
    batch.map((manga) => scanManga(manga, log)),
  );
}
