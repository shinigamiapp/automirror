import type { FastifyBaseLogger } from 'fastify';
import { CONFIG } from '../config.js';
import * as mangaRepo from '../db/repositories/manga.js';
import * as scraperService from '../services/scraper.js';
import * as backendService from '../services/backend.js';
import { publishMangaEvent } from '../services/realtime.js';
import type { MangaRegistry, ScraperChapterListItem } from '../types.js';

/**
 * Format a Date to MySQL DATETIME format (YYYY-MM-DD HH:MM:SS)
 */
function toMySQLDatetime(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Parse chapter number from a chapter title string.
 * e.g. "Chapter 26" -> 26, "Chapter 26.5" -> 26.5
 */
function parseChapterNumber(title: string): number {
  const match = title.match(/(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : 0;
}

/**
 * Extract chapter number from a scraper chapter item.
 * Priority: URL path segment > weight > title parse.
 * Chapters with special titles (e.g. "SIDE 1", "END") can have wrong numbers
 * if parsed from the title alone — the URL is the authoritative source.
 */
function getChapterNumber(ch: { title: string; url: string; weight?: number }): number {
  const urlMatch = ch.url.match(/\/chapter\/(\d+(?:\.\d+)?)\/?$/);
  if (urlMatch) return parseFloat(urlMatch[1]);
  if (ch.weight !== undefined && ch.weight >= 0) return ch.weight;
  return parseChapterNumber(ch.title);
}

/**
 * Scanner worker — checks for new chapters using metadata-first optimization.
 *
 * Flow:
 * 1. Quick metadata check (GET /manga/detail) — O(1)
 * 2. Fetch backend chapter count for comparison
 * 3. If no new or missing chapters → skip, just update next_scan_at
 * 4. If new/missing chapters → fetch full chapter list + backend chapters
 * 5. Create sync tasks for missing chapters
 */
export async function scanManga(
  manga: MangaRegistry,
  log: FastifyBaseLogger,
): Promise<void> {
  log.info({ mangaId: manga.manga_id, title: manga.series_title }, 'Scanning manga');

  await mangaRepo.updateMangaStatus(manga.id, 'scanning');

  // Publish scan started event (non-blocking)
  publishMangaEvent(manga.manga_id, 'manga.scan.started', {
    id: manga.id,
    series_title: manga.series_title,
    status: 'scanning',
  }).catch(() => {});

  try {
    // Step 1: Quick metadata check
    const detail = await scraperService.getMangaDetail(manga.manga_url);
    const sourceLastChapter = detail.chapterSummary.lastChapter.number;
    const sourceTotal = detail.chapterSummary.total;

    // Fetch backend chapter count for comparison
    const existingChapterNumbers = await backendService.getAllChapterNumbers(manga.manga_id);
    const backendCount = existingChapterNumbers.size;
    const backendLastChapter = backendCount > 0
      ? Math.max(...existingChapterNumbers)
      : null;

    await mangaRepo.updateBackendChapterStats(manga.id, {
      backend_chapter_count: backendCount,
      backend_last_chapter: backendLastChapter,
    });

    // Step 2: Skip only if last chapter is same AND chapter counts match
    // If counts differ, there might be missing chapters in the middle
    if (
      manga.source_last_chapter !== null &&
      sourceLastChapter <= manga.source_last_chapter &&
      sourceTotal === backendCount
    ) {
      log.info(
        { mangaId: manga.manga_id, lastChapter: sourceLastChapter, sourceTotal, backendCount },
        'No new or missing chapters found, skipping full scan',
      );

      const nextScan = toMySQLDatetime(new Date(
        Date.now() + manga.check_interval_minutes * 60_000,
      ));

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
        sourceTotal,
        backendCount,
      },
      'New or missing chapters detected, fetching full chapter list',
    );

    // Step 3: Fetch full chapter list from source
    const sourceChapters = await scraperService.getAllChapters(manga.manga_url);

    // Step 4: Find missing chapters (using already fetched backend chapters)
    const missingChapters = sourceChapters.filter((ch) => {
      const num = getChapterNumber(ch);
      return !existingChapterNumbers.has(num);
    });

    if (missingChapters.length === 0) {
      log.info({ mangaId: manga.manga_id }, 'All chapters already synced');

      const nextScan = toMySQLDatetime(new Date(
        Date.now() + manga.check_interval_minutes * 60_000,
      ));

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
        chapter_number: getChapterNumber(ch),
        weight: index,
      })),
    );

    // Update manga state
    const nextScan = toMySQLDatetime(new Date(
      Date.now() + manga.check_interval_minutes * 60_000,
    ));

    await mangaRepo.updateMangaScanResult(manga.id, {
      source_chapter_count: sourceTotal,
      source_last_chapter: sourceLastChapter,
      next_scan_at: nextScan,
    });

    // Transition to syncing
    await mangaRepo.updateMangaStatus(manga.id, 'syncing');

    // Update progress totals
    await mangaRepo.incrementSyncProgressTotal(manga.id, missingChapters.length);

    // Publish scan finished event with syncing status (non-blocking)
    publishMangaEvent(manga.manga_id, 'manga.scan.finished', {
      id: manga.id,
      series_title: manga.series_title,
      status: 'syncing',
      source_chapter_count: sourceTotal,
      source_last_chapter: sourceLastChapter,
      missing_chapters: missingChapters.length,
    }).catch(() => {});
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.error({ mangaId: manga.manga_id, err: error }, 'Scan failed');
    await mangaRepo.updateMangaStatus(manga.id, 'error', errMsg);

    // Publish scan finished event with error status (non-blocking)
    publishMangaEvent(manga.manga_id, 'manga.scan.finished', {
      id: manga.id,
      series_title: manga.series_title,
      status: 'error',
      error: errMsg,
    }).catch(() => {});
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
