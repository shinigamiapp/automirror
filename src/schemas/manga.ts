import { z } from 'zod';

export const createMangaSchema = z.object({
  manga_id: z.string().min(1),
  source_urls: z.array(z.string().url()).min(1).max(3),
  series_title: z.string().min(1),
  check_interval_minutes: z.number().int().min(1).default(360),
  priority: z.number().int().min(0).default(0),
  auto_sync_enabled: z.boolean().default(true),
});

export const updateMangaSchema = z.object({
  check_interval_minutes: z.number().int().min(1).optional(),
  priority: z.number().int().min(0).optional(),
  auto_sync_enabled: z.boolean().optional(),
  source_urls: z.array(z.string().url()).min(1).max(3).optional(),
  series_title: z.string().min(1).optional(),
});

export const mangaIdParamSchema = z.object({
  id: z.string().min(1),
});

export const listMangaQuerySchema = z.object({
  status: z.enum(['idle', 'scanning', 'syncing', 'error']).optional(),
  title: z.string().min(1).optional(),
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(100).default(20),
});

export const mangaSourceSchema = z.object({
  id: z.string(),
  source_url: z.string(),
  source_domain: z.string(),
  manga_slug: z.string(),
  priority: z.number(),
  is_enabled: z.boolean(),
  last_chapter_count: z.number().nullable(),
  last_chapter_number: z.number().nullable(),
  last_scan_status: z.string().nullable(),
  last_scan_error: z.string().nullable(),
  last_scan_at: z.string().nullable(),
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
  sources: z.array(mangaSourceSchema),
  created_at: z.string(),
  updated_at: z.string(),
});

export const bulkCreateMangaSchema = z.object({
  manga: z.array(createMangaSchema).min(1).max(50),
});

export const updateDomainSchema = z.object({
  old_domain: z.string().min(1),
  new_domain: z.string().min(1),
  manga_ids: z.array(z.string().min(1)).max(200).optional(),
  dry_run: z.boolean().default(true),
});
