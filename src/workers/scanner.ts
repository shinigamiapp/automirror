import type { FastifyBaseLogger } from 'fastify';
import { CONFIG } from '../config.js';
import * as mangaRepo from '../db/repositories/manga.js';
import * as scraperService from '../services/scraper.js';
import * as backendService from '../services/backend.js';
import * as realtime from '../services/realtime.js';
import type { MangaRegistry, MangaSource, ScraperChapterListItem } from '../types.js';

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

interface SourceScanResult {
  source: MangaSource;
  chapters: ScraperChapterListItem[];
  chapterCount: number;
  lastChapter: number | null;
}

async function fetchSourceChapters(source: MangaSource): Promise<SourceScanResult> {
  const chapters = await scraperService.getAllChapters(source.source_url);
  const chapterNumbers = chapters
    .map((chapter) => getChapterNumber(chapter))
    .filter((chapterNumber) => chapterNumber > 0);

  return {
    source,
    chapters,
    chapterCount: chapters.length,
    lastChapter: chapterNumbers.length > 0 ? Math.max(...chapterNumbers) : null,
  };
}

async function publishRealtimeEvent(event: realtime.MangaEvent): Promise<void> {
  try {
    await realtime.publishMangaEvent(event);
  } catch {
    // Realtime failures should never block scans.
  }
}

export async function scanManga(
  manga: MangaRegistry,
  log: FastifyBaseLogger,
): Promise<void> {
  log.info({ mangaId: manga.manga_id, title: manga.series_title }, 'Scanning manga');

  await mangaRepo.updateMangaStatus(manga.id, 'scanning');
  await publishRealtimeEvent({
    type: 'manga.scan.started',
    manga_id: manga.manga_id,
    data: { manga_id: manga.manga_id },
    event_version: Date.now(),
    timestamp: new Date().toISOString(),
  });

  try {
    const sources = await mangaRepo.getEnabledSources(manga.id);
    if (sources.length === 0) {
      await mangaRepo.updateMangaStatus(manga.id, 'error', 'No enabled sources configured');
      await publishRealtimeEvent({
        type: 'manga.scan.finished',
        manga_id: manga.manga_id,
        data: {
          status: 'error',
          source_chapter_count: manga.source_chapter_count,
          missing_count: 0,
          message: 'No enabled sources configured',
        },
        event_version: Date.now(),
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const sourceResults = await Promise.allSettled(
      sources.map((source) => fetchSourceChapters(source)),
    );

    const successfulSources: SourceScanResult[] = [];
    for (const [index, result] of sourceResults.entries()) {
      const source = sources[index];
      if (result.status === 'fulfilled' && result.value.chapterCount > 0) {
        successfulSources.push(result.value);
        await mangaRepo.updateSourceScanStatus(source.id, 'success', {
          last_chapter_count: result.value.chapterCount,
          last_chapter_number: result.value.lastChapter,
          error: null,
        });
      } else {
        const isRejected = result.status === 'rejected';
        const message = isRejected
          ? (result.reason instanceof Error ? result.reason.message : String(result.reason))
          : 'Source returned no chapters';
        await mangaRepo.updateSourceScanStatus(source.id, isRejected ? 'error' : 'empty', {
          error: message,
        });
      }
    }

    if (successfulSources.length === 0) {
      await mangaRepo.updateMangaStatus(manga.id, 'error', 'All configured sources failed');
      await publishRealtimeEvent({
        type: 'manga.scan.finished',
        manga_id: manga.manga_id,
        data: {
          status: 'error',
          source_chapter_count: manga.source_chapter_count,
          missing_count: 0,
          message: 'All configured sources failed',
        },
        event_version: Date.now(),
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const bestSource = successfulSources.reduce((best, current) => (
      current.chapterCount > best.chapterCount ? current : best
    ));

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

    log.info(
      {
        mangaId: manga.manga_id,
        sourcesChecked: sources.length,
        sourcesSucceeded: successfulSources.length,
        selectedSourceDomain: bestSource.source.source_domain,
        selectedSourceChapterCount: bestSource.chapterCount,
      },
      'Selected source with highest chapter count',
    );

    const missingChapters = bestSource.chapters.filter((ch) => {
      const num = getChapterNumber(ch);
      return !existingChapterNumbers.has(num);
    });

    const nextScan = toMySQLDatetime(new Date(
      Date.now() + manga.check_interval_minutes * 60_000,
    ));

    await mangaRepo.updateMangaScanResult(manga.id, {
      source_chapter_count: bestSource.chapterCount,
      source_last_chapter: bestSource.lastChapter,
      next_scan_at: nextScan,
    });

    if (missingChapters.length === 0) {
      await publishRealtimeEvent({
        type: 'manga.scan.finished',
        manga_id: manga.manga_id,
        data: {
          status: 'idle',
          source_chapter_count: bestSource.chapterCount,
          missing_count: 0,
          source_domain: bestSource.source.source_domain,
        },
        event_version: Date.now(),
        timestamp: new Date().toISOString(),
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
        source_id: bestSource.source.id,
      })),
    );

    // Transition to syncing
    await mangaRepo.updateMangaStatus(manga.id, 'syncing');

    // Update progress totals
    await mangaRepo.incrementSyncProgressTotal(manga.id, missingChapters.length);

    await publishRealtimeEvent({
      type: 'manga.scan.finished',
      manga_id: manga.manga_id,
      data: {
        status: 'syncing',
        source_chapter_count: bestSource.chapterCount,
        missing_count: missingChapters.length,
        source_domain: bestSource.source.source_domain,
      },
      event_version: Date.now(),
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.error({ mangaId: manga.manga_id, err: error }, 'Scan failed');
    await mangaRepo.updateMangaStatus(manga.id, 'error', errMsg);
    await publishRealtimeEvent({
      type: 'manga.scan.finished',
      manga_id: manga.manga_id,
      data: {
        status: 'error',
        source_chapter_count: manga.source_chapter_count,
        missing_count: 0,
        error: errMsg,
      },
      event_version: Date.now(),
      timestamp: new Date().toISOString(),
    });
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
