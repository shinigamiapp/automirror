import { describe, it, expect } from 'vitest';
import { toRealtimePayload } from './realtime.js';
import type { MangaRegistry } from '../types.js';

describe('toRealtimePayload', () => {
  const mockManga: MangaRegistry = {
    id: 'uuid-123',
    manga_id: 'manga-456',
    manga_url: 'https://example.com/manga/test',
    source_domain: 'example.com',
    manga_slug: 'test-manga',
    series_title: 'Test Manga',
    auto_sync_enabled: 1,
    check_interval_minutes: 60,
    priority: 1,
    source_chapter_count: 100,
    source_last_chapter: 100,
    backend_chapter_count: 95,
    backend_last_chapter: 95,
    status: 'syncing',
    sync_progress_total: 5,
    sync_progress_completed: 3,
    sync_progress_failed: 0,
    last_scanned_at: '2024-01-01 12:00:00',
    last_synced_at: '2024-01-01 11:00:00',
    next_scan_at: '2024-01-01 13:00:00',
    last_error: null,
    last_error_at: null,
    consecutive_failures: 0,
    created_at: '2024-01-01 00:00:00',
    updated_at: '2024-01-01 12:00:00',
  };

  it('should include all list-relevant fields', () => {
    const payload = toRealtimePayload(mockManga);

    expect(payload).toEqual({
      id: 'uuid-123',
      manga_id: 'manga-456',
      series_title: 'Test Manga',
      source_domain: 'example.com',
      status: 'syncing',
      auto_sync_enabled: 1,
      source_chapter_count: 100,
      source_last_chapter: 100,
      backend_chapter_count: 95,
      backend_last_chapter: 95,
      sync_progress_total: 5,
      sync_progress_completed: 3,
      sync_progress_failed: 0,
      last_scanned_at: '2024-01-01 12:00:00',
      last_synced_at: '2024-01-01 11:00:00',
      next_scan_at: '2024-01-01 13:00:00',
      last_error: null,
      consecutive_failures: 0,
      updated_at: '2024-01-01 12:00:00',
    });
  });

  it('should NOT include internal fields', () => {
    const payload = toRealtimePayload(mockManga);

    expect(payload).not.toHaveProperty('manga_url');
    expect(payload).not.toHaveProperty('manga_slug');
    expect(payload).not.toHaveProperty('check_interval_minutes');
    expect(payload).not.toHaveProperty('priority');
    expect(payload).not.toHaveProperty('last_error_at');
    expect(payload).not.toHaveProperty('created_at');
  });

  it('should handle null values correctly', () => {
    const mangaWithNulls: MangaRegistry = {
      ...mockManga,
      source_last_chapter: null,
      backend_last_chapter: null,
      last_scanned_at: null,
      last_synced_at: null,
      next_scan_at: null,
      last_error: 'Some error',
    };

    const payload = toRealtimePayload(mangaWithNulls);

    expect(payload.source_last_chapter).toBeNull();
    expect(payload.backend_last_chapter).toBeNull();
    expect(payload.last_scanned_at).toBeNull();
    expect(payload.last_synced_at).toBeNull();
    expect(payload.next_scan_at).toBeNull();
    expect(payload.last_error).toBe('Some error');
  });

  it('should handle all status types', () => {
    const statuses = ['idle', 'scanning', 'syncing', 'error'] as const;

    for (const status of statuses) {
      const manga = { ...mockManga, status };
      const payload = toRealtimePayload(manga);
      expect(payload.status).toBe(status);
    }
  });

  it('should return a plain object (not the original reference)', () => {
    const payload = toRealtimePayload(mockManga);

    expect(payload).not.toBe(mockManga);
    expect(typeof payload).toBe('object');
  });
});
