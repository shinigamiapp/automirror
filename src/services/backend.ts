import { CONFIG } from '../config.js';
import { fetchJson } from '../utils/fetch.js';
import type { BackendResponse, BackendChapter } from '../types.js';

/**
 * GET /chapter/{manga_id}/list — paginated chapter list from backend.
 */
export async function getChapterList(
  mangaId: string,
  options?: { page?: number; pageSize?: number; sortOrder?: 'asc' | 'desc' },
): Promise<BackendResponse<BackendChapter[]>> {
  const params = new URLSearchParams();
  params.set('page', String(options?.page ?? 1));
  params.set('page_size', String(options?.pageSize ?? 100));
  params.set('sort_order', options?.sortOrder ?? 'asc');

  return fetchJson<BackendResponse<BackendChapter[]>>(
    `${CONFIG.BACKEND_API_URL}/chapter/${mangaId}/list?${params}`,
    {
      headers: { 'X-API-KEY': CONFIG.BACKEND_API_KEY },
      timeoutMs: CONFIG.FETCH_TIMEOUT_MS,
    },
  );
}

/**
 * Fetch ALL backend chapters across all pages.
 */
export async function getAllChapterNumbers(mangaId: string): Promise<Set<number>> {
  const chapterNumbers = new Set<number>();
  let page = 1;

  while (true) {
    const response = await getChapterList(mangaId, { page, pageSize: 100, sortOrder: 'asc' });

    if (!response.data || response.data.length === 0) break;

    for (const ch of response.data) {
      chapterNumbers.add(ch.chapter_number);
    }

    if (!response.meta || page >= response.meta.total_page) break;
    page++;
  }

  return chapterNumbers;
}

/**
 * POST /admin/chapter/create/{manga_id} — create chapters in backend.
 */
export async function createChapters(
  mangaId: string,
  chapters: Array<{
    chapter_id: string;
    chapter_number: number;
    chapter_title?: string;
    chapter_images?: string[];
    path?: string;
    release_date?: string;
    thumbnail_image_url?: string;
  }>,
): Promise<BackendResponse<null>> {
  return fetchJson<BackendResponse<null>>(
    `${CONFIG.BACKEND_API_URL}/admin/chapter/create/${mangaId}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-KEY': CONFIG.BACKEND_API_KEY,
      },
      body: JSON.stringify({ chapters }),
      timeoutMs: CONFIG.FETCH_TIMEOUT_MS,
    },
  );
}
