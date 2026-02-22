import { CONFIG } from '../config.js';
import { fetchJson } from '../utils/fetch.js';
import type {
  ScraperMangaDetailResponse,
  ScraperChapterListResponse,
  ScraperChapterListItem,
  ScraperChapterDetailResponse,
  ScraperUploadChapterResponse,
} from '../types.js';

/**
 * GET /manga/detail — lightweight metadata + chapter summary.
 */
export async function getMangaDetail(
  mangaUrl: string,
  refresh = false,
): Promise<ScraperMangaDetailResponse> {
  const params = new URLSearchParams({ url: mangaUrl });
  if (refresh) params.set('refresh', 'true');

  return fetchJson<ScraperMangaDetailResponse>(
    `${CONFIG.SCRAPER_BASE_URL}/manga/detail?${params}`,
    { timeoutMs: CONFIG.SCRAPE_TIMEOUT_MS },
  );
}

/**
 * GET /manga/chapter/list — paginated chapter list.
 * Returns all chapters by fetching every page.
 */
export async function getChapterList(
  mangaUrl: string,
  options?: { page?: number; limit?: number; refresh?: boolean },
): Promise<ScraperChapterListResponse> {
  const params = new URLSearchParams({ url: mangaUrl });
  if (options?.page) params.set('page', String(options.page));
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.refresh) params.set('refresh', 'true');

  return fetchJson<ScraperChapterListResponse>(
    `${CONFIG.SCRAPER_BASE_URL}/manga/chapter/list?${params}`,
    { timeoutMs: CONFIG.SCRAPE_TIMEOUT_MS },
  );
}

/**
 * Fetch ALL chapters across all pages.
 */
export async function getAllChapters(
  mangaUrl: string,
): Promise<ScraperChapterListItem[]> {
  const allChapters: ScraperChapterListItem[] = [];
  let page = 1;
  const limit = 200;

  while (true) {
    const response = await getChapterList(mangaUrl, { page, limit });

    // If the cache is still loading, wait and retry
    if (response.status === 'loading' || response.status === 'not_cached') {
      await new Promise((r) => setTimeout(r, 3000));
      continue;
    }

    allChapters.push(...response.data);

    if (!response.hasMore) break;
    page++;
  }

  return allChapters;
}

/**
 * GET /manga/chapter/detail — get images for a specific chapter.
 */
export async function getChapterDetail(
  chapterUrl: string,
): Promise<ScraperChapterDetailResponse> {
  const params = new URLSearchParams({ url: chapterUrl });

  return fetchJson<ScraperChapterDetailResponse>(
    `${CONFIG.SCRAPER_BASE_URL}/manga/chapter/detail?${params}`,
    { timeoutMs: CONFIG.SCRAPE_TIMEOUT_MS },
  );
}

/**
 * POST /uploads/chapter — download images, create ZIP, upload to R2.
 */
export async function uploadChapter(data: {
  imageDataArray: Array<{ index: number; download_url: string }>;
  manga_id: string;
  chapterNumber: string;
  seriesTitle: string;
  chapterUrl?: string;
}): Promise<ScraperUploadChapterResponse> {
  return fetchJson<ScraperUploadChapterResponse>(
    `${CONFIG.SCRAPER_BASE_URL}/uploads/chapter`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      timeoutMs: CONFIG.UPLOAD_TIMEOUT_MS,
    },
  );
}
