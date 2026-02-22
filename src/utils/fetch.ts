import { CONFIG } from '../config.js';

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly statusText: string,
    public readonly url: string,
    public readonly body?: string,
  ) {
    super(`HTTP ${status} ${statusText} from ${url}`);
    this.name = 'HttpError';
  }
}

export async function fetchWithTimeout(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {},
): Promise<Response> {
  const { timeoutMs = CONFIG.FETCH_TIMEOUT_MS, ...fetchOptions } = options;

  const response = await fetch(url, {
    ...fetchOptions,
    signal: AbortSignal.timeout(timeoutMs),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => undefined);
    throw new HttpError(response.status, response.statusText, url, body);
  }

  return response;
}

export async function fetchJson<T>(
  url: string,
  options: RequestInit & { timeoutMs?: number } = {},
): Promise<T> {
  const response = await fetchWithTimeout(url, options);
  return response.json() as Promise<T>;
}
