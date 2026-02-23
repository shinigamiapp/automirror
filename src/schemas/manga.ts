import { z } from 'zod';

export const createMangaSchema = z.object({
  manga_id: z.string().min(1),
  manga_url: z.string().url(),
  series_title: z.string().min(1),
  check_interval_minutes: z.number().int().min(1).default(20),
  priority: z.number().int().min(0).default(0),
  auto_sync_enabled: z.boolean().default(true),
});

export const updateMangaSchema = z.object({
  check_interval_minutes: z.number().int().min(1).optional(),
  priority: z.number().int().min(0).optional(),
  auto_sync_enabled: z.boolean().optional(),
  manga_url: z.string().url().optional(),
  series_title: z.string().min(1).optional(),
});

export const mangaIdParamSchema = z.object({
  id: z.string().min(1),
});

export const listMangaQuerySchema = z.object({
  status: z.enum(['idle', 'scanning', 'syncing', 'error']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

export const mangaResponseSchema = z.object({
  id: z.string(),
  manga_id: z.string(),
  manga_url: z.string(),
  source_domain: z.string(),
  manga_slug: z.string(),
  series_title: z.string(),
  auto_sync_enabled: z.number(),
  check_interval_minutes: z.number(),
  priority: z.number(),
  source_chapter_count: z.number(),
  source_last_chapter: z.number().nullable(),
  backend_chapter_count: z.number(),
  backend_last_chapter: z.number().nullable(),
  status: z.string(),
  sync_progress_total: z.number(),
  sync_progress_completed: z.number(),
  sync_progress_failed: z.number(),
  last_scanned_at: z.string().nullable(),
  last_synced_at: z.string().nullable(),
  next_scan_at: z.string().nullable(),
  last_error: z.string().nullable(),
  last_error_at: z.string().nullable(),
  consecutive_failures: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});

export const bulkCreateMangaSchema = z.object({
  manga: z.array(createMangaSchema).min(1).max(50),
});

export const updateDomainSchema = z.object({
  old_domain: z.string().min(1),
  new_domain: z.string().min(1),
});
