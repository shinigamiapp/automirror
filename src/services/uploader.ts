import { CONFIG } from '../config.js';
import { fetchJson } from '../utils/fetch.js';
import type { UploaderResponse } from '../types.js';

/**
 * POST /v1/upload/single — upload a ZIP to B2 storage (synchronous).
 */
export async function uploadSingle(data: {
  zip_url: string;
  manga_id: string;
  chapter_number: number;
}): Promise<UploaderResponse> {
  return fetchJson<UploaderResponse>(
    `${CONFIG.UPLOADER_BASE_URL}/v1/upload/single`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': CONFIG.UPLOADER_API_KEY,
      },
      body: JSON.stringify(data),
      timeoutMs: CONFIG.UPLOAD_TIMEOUT_MS,
    },
  );
}
