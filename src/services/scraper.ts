import { CONFIG } from '../config.js';
import { fetchJson } from '../utils/fetch.js';
import type {
  ScraperMangaDetailResponse,
  ScraperChapterListResponse,
  ScraperChapterListItem,
  ScraperChapterDetailResponse,
  ScraperUploadChapterResponse,
} from '../types.js';

interface ScraperHostState {
  url: string;
  failures: number;
  isHealthy: boolean;
  lastFailureAt: number | null;
}

type ScraperStrategy = 'round_robin' | 'failover';

export class ScraperHostPool {
  private readonly hosts: ScraperHostState[];

  private readonly strategy: ScraperStrategy;

  private readonly maxFailures: number;

  private nextIndex = 0;

  constructor(hostUrls: string[], strategy: ScraperStrategy, maxFailures: number) {
    const normalizedHosts = hostUrls
      .map((host) => host.trim())
      .filter((host) => host.length > 0);
    if (normalizedHosts.length === 0) {
      throw new Error('At least one scraper host is required');
    }

    this.hosts = normalizedHosts.map((url) => ({
      url,
      failures: 0,
      isHealthy: true,
      lastFailureAt: null,
    }));
    this.strategy = strategy;
    this.maxFailures = maxFailures;
  }

  private getHealthyHosts(): ScraperHostState[] {
    const healthy = this.hosts.filter((host) => host.isHealthy);
    if (healthy.length > 0) return healthy;

    for (const host of this.hosts) {
      host.isHealthy = true;
      host.failures = 0;
      host.lastFailureAt = null;
    }
    return [...this.hosts];
  }

  getRequestOrder(): ScraperHostState[] {
    const healthyHosts = this.getHealthyHosts();
    if (this.strategy === 'failover') {
      return [...healthyHosts];
    }

    const start = this.nextIndex % healthyHosts.length;
    this.nextIndex = (this.nextIndex + 1) % healthyHosts.length;
    return [
      ...healthyHosts.slice(start),
      ...healthyHosts.slice(0, start),
    ];
  }

  markSuccess(hostUrl: string): void {
    const host = this.hosts.find((entry) => entry.url === hostUrl);
    if (!host) return;
    host.failures = 0;
    host.isHealthy = true;
    host.lastFailureAt = null;
  }

  markFailure(hostUrl: string): void {
    const host = this.hosts.find((entry) => entry.url === hostUrl);
    if (!host) return;

    host.failures += 1;
    host.lastFailureAt = Date.now();
    if (host.failures >= this.maxFailures) {
      host.isHealthy = false;
    }
  }

  snapshot(): Array<{
    url: string;
    failures: number;
    isHealthy: boolean;
    lastFailureAt: number | null;
  }> {
    return this.hosts.map((host) => ({ ...host }));
  }
}

const configuredHosts = CONFIG.SCRAPER_HOSTS.split(',').map((host) => host.trim()).filter(Boolean);
export const scraperPool = new ScraperHostPool(
  configuredHosts.length > 0 ? configuredHosts : [CONFIG.SCRAPER_BASE_URL],
  CONFIG.SCRAPER_STRATEGY === 'failover' ? 'failover' : 'round_robin',
  CONFIG.SCRAPER_HOST_MAX_FAILURES,
);

async function requestFromPool<T>(
  path: string,
  options: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const orderedHosts = scraperPool.getRequestOrder();
  let lastError: unknown = null;

  for (const host of orderedHosts) {
    try {
      const result = await fetchJson<T>(
        `${host.url}${path}`,
        {
          ...options,
          timeoutMs: options.timeoutMs ?? CONFIG.SCRAPER_HOST_TIMEOUT_MS,
        },
      );
      scraperPool.markSuccess(host.url);
      return result;
    } catch (error) {
      scraperPool.markFailure(host.url);
      lastError = error;
    }
  }

  if (lastError instanceof Error) {
    throw lastError;
  }
  throw new Error('All scraper hosts failed');
}

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

export async function getAllChapters(
  mangaUrl: string,
): Promise<ScraperChapterListItem[]> {
  const allChapters: ScraperChapterListItem[] = [];
  let page = 1;
  const limit = 200;

  while (true) {
    const response = await getChapterList(mangaUrl, { page, limit });

    if (response.status === 'loading' || response.status === 'not_cached') {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      continue;
    }

    allChapters.push(...response.data);
    if (!response.hasMore) break;
    page += 1;
  }

  return allChapters;
}

export async function getChapterDetail(
  chapterUrl: string,
): Promise<ScraperChapterDetailResponse> {
  const params = new URLSearchParams({ url: chapterUrl });

  return requestFromPool<ScraperChapterDetailResponse>(
    `/manga/chapter/detail?${params}`,
    { timeoutMs: CONFIG.SCRAPE_TIMEOUT_MS },
  );
}

export async function uploadChapter(data: {
  imageDataArray: Array<{ index: number; download_url: string }>;
  manga_id: string;
  chapterNumber: string;
  seriesTitle: string;
  chapterUrl?: string;
}): Promise<ScraperUploadChapterResponse> {
  return requestFromPool<ScraperUploadChapterResponse>(
    '/uploads/chapter',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      timeoutMs: CONFIG.UPLOAD_TIMEOUT_MS,
    },
  );
}
