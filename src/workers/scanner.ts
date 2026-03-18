import type { FastifyBaseLogger } from 'fastify';
import { CONFIG } from '../config.js';
import * as mangaRepo from '../db/repositories/manga.js';
import * as scraperService from '../services/scraper.js';
import * as backendService from '../services/backend.js';
import { publishMangaEvent, toRealtimePayload } from '../services/realtime.js';
import type { MangaRegistry, ScraperChapterListItem } from '../types.js';

/**
 * Format a Date to MySQL DATETIME format (YYYY-MM-DD HH:MM:SS)
 */
function toMySQLDatetime(date: Date): string {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

// ============================================================================
// Connector-Specific Chapter Parsing
// ============================================================================

type ChapterParseResult = { ok: true; value: number } | { ok: false; error: string };

type Brand = 'komikcast' | 'kiryuu' | 'ikiru' | 'westmanga' | 'cosmicscans' | 'apkomik' | 'mgkomik' | 'unknown';

function detectBrand(sourceDomain: string): Brand {
  const domain = sourceDomain.toLowerCase();
  if (/komikcast/.test(domain)) return 'komikcast';
  if (/kiryuu/.test(domain)) return 'kiryuu';
  if (/ikiru/.test(domain)) return 'ikiru';
  if (/westmanga/.test(domain)) return 'westmanga';
  if (/cosmicscans/.test(domain)) return 'cosmicscans';
  if (/apkomik/.test(domain)) return 'apkomik';
  if (/mgkomik/.test(domain)) return 'mgkomik';
  return 'unknown';
}

const BRAND_EXTRACTORS: Record<Brand, (url: string, title: string) => ChapterParseResult> = {
  komikcast: (url) => {
    const m = url.match(/\/chapter\/(\d+(?:\.\d+)?)/);
    return m ? { ok: true, value: parseFloat(m[1]) } : { ok: false, error: 'komikcast: no /chapter/N match' };
  },

  kiryuu: (url) => {
    // Pattern: /chapter-N.postId/ or /chapter-N.M.postId/ where postId is 5+ digits
    const m = url.match(/\/chapter-(\d+(?:\.\d+)?)\.\d{5,}/);
    return m ? { ok: true, value: parseFloat(m[1]) } : { ok: false, error: 'kiryuu: no /chapter-N.postId match' };
  },

  ikiru: (url) => {
    const m = url.match(/\/chapter-(\d+(?:\.\d+)?)\.\d{5,}/);
    return m ? { ok: true, value: parseFloat(m[1]) } : { ok: false, error: 'ikiru: no /chapter-N.postId match' };
  },

  westmanga: (url) => {
    // Try decimal first: -chapter-271-5-
    const dec = url.match(/-chapter-(\d+)-(\d+)-/);
    if (dec) return { ok: true, value: parseFloat(`${dec[1]}.${dec[2]}`) };
    // Integer: -chapter-271-end- or -chapter-271-bahasa-
    const int = url.match(/-chapter-(\d+)-[^0-9]/);
    if (int) return { ok: true, value: parseFloat(int[1]) };
    return { ok: false, error: 'westmanga: no -chapter-N- match' };
  },

  cosmicscans: (url) => {
    // Try decimal: -chapter-271-5/
    const dec = url.match(/-chapter-(\d+)-(\d+)\//);
    if (dec) return { ok: true, value: parseFloat(`${dec[1]}.${dec[2]}`) };
    // Integer: -chapter-271/
    const int = url.match(/-chapter-(\d+)\//);
    if (int) return { ok: true, value: parseFloat(int[1]) };
    return { ok: false, error: 'cosmicscans: no -chapter-N/ match' };
  },

  apkomik: (url, title) => {
    // Try decimal: -chapter-05-2-bahasa
    const dec = url.match(/-chapter-(\d+)-(\d+)-bahasa/);
    if (dec) return { ok: true, value: parseFloat(`${dec[1]}.${dec[2]}`) };
    // Integer: -chapter-05-bahasa
    const int = url.match(/-chapter-(\d+)-bahasa/);
    if (int) return { ok: true, value: parseFloat(int[1]) };
    // Fallback: try title if URL doesn't match (e.g., chapter-0-bahasa)
    const titleMatch = title.match(/chapter\s*(\d+(?:\.\d+)?)/i);
    if (titleMatch) return { ok: true, value: parseFloat(titleMatch[1]) };
    return { ok: false, error: 'apkomik: no -chapter-N-bahasa match' };
  },

  mgkomik: (url, title) => {
    const m = url.match(/\/chapter-(\d+)\/?$/);
    if (!m) return { ok: false, error: 'mgkomik: no /chapter-N/ match' };

    const token = m[1];
    let urlValue: number;

    // Decode zero-padded tokens
    if (token.startsWith('0') && token.length >= 2) {
      // 085 -> 8.5, 08 -> 8, 0125 -> 1.25
      const rest = token.slice(1);
      if (rest.length === 1) {
        urlValue = parseFloat(rest); // 08 -> 8
      } else {
        urlValue = parseFloat(`${rest[0]}.${rest.slice(1)}`); // 085 -> 8.5
      }
    } else {
      urlValue = parseFloat(token); // No leading zero -> integer
    }

    // Title conflict check: if title has decimal and URL is integer, title wins
    const titleMatch = title.match(/chapter\s*(\d+(?:\.\d+)?)/i);
    if (titleMatch) {
      const titleValue = parseFloat(titleMatch[1]);
      // If URL gave integer but title has decimal -> title wins
      if (Number.isInteger(urlValue) && !Number.isInteger(titleValue)) {
        return { ok: true, value: titleValue };
      }
    }

    return { ok: true, value: urlValue };
  },

  unknown: (url, title) => {
    // Generic fallback: try common patterns
    const patterns = [
      /\/chapter\/(\d+(?:\.\d+)?)/,
      /\/chapter-(\d+(?:\.\d+)?)\.\d{5,}/, // kiryuu-style with postId
      /\/chapter-(\d+(?:\.\d+)?)/,
      /-chapter-(\d+)-(\d+)/, // decimal via hyphen
      /-chapter-(\d+)/,
    ];

    for (const p of patterns) {
      const m = url.match(p);
      if (m) {
        if (m[2]) return { ok: true, value: parseFloat(`${m[1]}.${m[2]}`) };
        return { ok: true, value: parseFloat(m[1]) };
      }
    }

    // Last resort: title parse
    const titleMatch = title.match(/(\d+(?:\.\d+)?)/);
    if (titleMatch) {
      const v = parseFloat(titleMatch[1]);
      if (v > 0) return { ok: true, value: v };
    }

    return { ok: false, error: 'unknown brand: no chapter pattern matched in URL or title' };
  },
};

/**
 * Extract chapter number from a scraper chapter item using connector-specific parsing.
 * Returns a result object indicating success/failure.
 */
function getChapterNumber(
  ch: { title: string; url: string; weight?: number },
  sourceDomain: string,
): ChapterParseResult {
  const brand = detectBrand(sourceDomain);
  const result = BRAND_EXTRACTORS[brand](ch.url, ch.title);

  // If parsing succeeded and value is 0, convert to 0.1 (chapter 0 = prologue)
  // Backend API rejects chapter_number=0, so we use 0.1 for prologues
  if (result.ok && result.value === 0) {
    return { ok: true, value: 0.1 };
  }

  return result;
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

  // Publish scan started event with enriched payload (non-blocking)
  mangaRepo.getMangaById(manga.id).then((updated) => {
    if (updated) {
      publishMangaEvent(manga.manga_id, 'manga.scan.started', toRealtimePayload(updated));
    }
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

    // Step 4: Find missing chapters with connector-specific parsing
    const missingChapters: Array<{ ch: ScraperChapterListItem; num: number }> = [];
    const parseErrors: string[] = [];

    for (const ch of sourceChapters) {
      const result = getChapterNumber(ch, manga.source_domain);
      if (!result.ok) {
        parseErrors.push(`${ch.url}: ${result.error}`);
        continue;
      }
      if (!existingChapterNumbers.has(result.value)) {
        missingChapters.push({ ch, num: result.value });
      }
    }

    // Log parse errors but don't fail the scan (some URLs may be malformed)
    if (parseErrors.length > 0) {
      log.warn(
        { mangaId: manga.manga_id, errorCount: parseErrors.length, errors: parseErrors.slice(0, 5) },
        'Some chapters failed to parse',
      );
    }

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

    // Create sync tasks with pre-parsed chapter numbers
    await mangaRepo.createSyncTasks(
      manga.id,
      missingChapters.map(({ ch, num }, index) => ({
        chapter_url: ch.url,
        chapter_number: num,
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

    // Publish scan finished event with enriched payload (non-blocking)
    mangaRepo.getMangaById(manga.id).then((updated) => {
      if (updated) {
        publishMangaEvent(manga.manga_id, 'manga.scan.finished', {
          ...toRealtimePayload(updated),
          missing_chapters: missingChapters.length,
        });
      }
    }).catch(() => {});
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    log.error({ mangaId: manga.manga_id, err: error }, 'Scan failed');
    await mangaRepo.updateMangaStatus(manga.id, 'error', errMsg);

    // Publish scan finished event with enriched payload (non-blocking)
    mangaRepo.getMangaById(manga.id).then((updated) => {
      if (updated) {
        publishMangaEvent(manga.manga_id, 'manga.scan.finished', {
          ...toRealtimePayload(updated),
          error: errMsg,
        });
      }
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
