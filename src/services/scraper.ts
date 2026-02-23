import { CONFIG } from '../config.js';
import { fetchJson, fetchWithTimeout } from '../utils/fetch.js';
import type {
  ScraperMangaDetailResponse,
  ScraperChapterListResponse,
  ScraperChapterListItem,
  ScraperChapterDetailResponse,
  ScraperUploadChapterResponse,
} from '../types.js';

// ============================================================================
// Scraper Host Pool — Round-robin load balancing with health tracking
// ============================================================================

interface HostState {
  url: string;
  failures: number;
  lastFailure: number | null;
  isHealthy: boolean;
}

class ScraperHostPool {
  private hosts: HostState[];
  private currentIndex = 0;
  private readonly maxFailures: number;
  private readonly cooldownMs = 60_000; // 1 minute cooldown before retrying unhealthy host

  constructor(hostsConfig: string, maxFailures: number) {
    const hostUrls = hostsConfig
      .split(',')
      .map((h) => h.trim())
      .filter(Boolean);

    if (hostUrls.length === 0) {
      throw new Error('SCRAPER_HOSTS must contain at least one host');
    }

    this.hosts = hostUrls.map((url) => ({
      url: url.replace(/\/$/, ''), // Remove trailing slash
      failures: 0,
      lastFailure: null,
      isHealthy: true,
    }));

    this.maxFailures = maxFailures;
  }

  getNextHost(): HostState {
    const now = Date.now();
    const startIndex = this.currentIndex;

    // Try to find a healthy host using round-robin
    for (let i = 0; i < this.hosts.length; i++) {
      const index = (startIndex + i) % this.hosts.length;
      const host = this.hosts[index];

      // Check if unhealthy host has cooled down
      if (!host.isHealthy && host.lastFailure) {
        if (now - host.lastFailure > this.cooldownMs) {
          host.isHealthy = true;
          host.failures = 0;
        }
      }

      if (host.isHealthy) {
        this.currentIndex = (index + 1) % this.hosts.length;
        return host;
      }
    }

    // All hosts unhealthy — reset the first one and use it
    const fallback = this.hosts[0];
    fallback.isHealthy = true;
    fallback.failures = 0;
    this.currentIndex = 1 % this.hosts.length;
    return fallback;
  }

  markSuccess(host: HostState): void {
    host.failures = 0;
    host.isHealthy = true;
  }

  markFailure(host: HostState): void {
    host.failures++;
    host.lastFailure = Date.now();
    if (host.failures >= this.maxFailures) {
      host.isHealthy = false;
    }
  }

  getStatus(): Array<{ url: string; healthy: boolean; failures: number }> {
    return this.hosts.map((h) => ({
      url: h.url,
      healthy: h.isHealthy,
      failures: h.failures,
    }));
  }
}

// Singleton pool instance
const hostPool = new ScraperHostPool(
  CONFIG.SCRAPER_HOSTS,
  CONFIG.SCRAPER_HOST_MAX_FAILURES,
);

/**
 * Make a request through the host pool with automatic failover.
 */
async function requestFromPool<T>(
  path: string,
  options: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const maxRetries = Math.min(3, hostPool.getStatus().length);
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const host = hostPool.getNextHost();
    const url = `${host.url}${path}`;

    try {
      const response = await fetchWithTimeout(url, {
        ...options,
        timeoutMs: options.timeoutMs ?? CONFIG.SCRAPER_HOST_TIMEOUT_MS,
      });
      const data = await response.json() as T;
      hostPool.markSuccess(host);
      return data;
    } catch (error) {
      hostPool.markFailure(host);
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  throw lastError ?? new Error('All scraper hosts failed');
}

/**
 * Get current pool status for monitoring.
 */
export function getPoolStatus() {
  return hostPool.getStatus();
}

// ============================================================================
// Scraper API Functions
// ============================================================================

/**
 * GET /manga/detail — lightweight metadata + chapter summary.
 */
export async function getMangaDetail(
  mangaUrl: string,
  refresh = false,
): Promise<ScraperMangaDetailResponse> {
  const params = new URLSearchParams({ url: mangaUrl });
  if (refresh) params.set('refresh', 'true');

  return requestFromPool<ScraperMangaDetailResponse>(
    `/manga/detail?${params}`,
    { timeoutMs: CONFIG.SCRAPE_TIMEOUT_MS },
  );
}

/**
 * GET /manga/chapter/list — paginated chapter list.
 */
export async function getChapterList(
  mangaUrl: string,
  options?: { page?: number; limit?: number; refresh?: boolean },
): Promise<ScraperChapterListResponse> {
  const params = new URLSearchParams({ url: mangaUrl });
  if (options?.page) params.set('page', String(options.page));
  if (options?.limit) params.set('limit', String(options.limit));
  if (options?.refresh) params.set('refresh', 'true');

  return requestFromPool<ScraperChapterListResponse>(
    `/manga/chapter/list?${params}`,
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

  return requestFromPool<ScraperChapterDetailResponse>(
    `/manga/chapter/detail?${params}`,
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
  return requestFromPool<ScraperUploadChapterResponse>(
    `/uploads/chapter`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      timeoutMs: CONFIG.UPLOAD_TIMEOUT_MS,
    },
  );
}
