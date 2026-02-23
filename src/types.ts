// --- Manga Registry ---

export interface MangaRegistry {
  id: string;
  manga_id: string;
  manga_url: string;
  source_domain: string;
  manga_slug: string;
  series_title: string;

  auto_sync_enabled: number; // SQLite boolean (0/1)
  check_interval_minutes: number;
  priority: number;

  source_chapter_count: number;
  source_last_chapter: number | null;

  backend_chapter_count: number;
  backend_last_chapter: number | null;

  status: MangaStatus;
  sync_progress_total: number;
  sync_progress_completed: number;
  sync_progress_failed: number;

  last_scanned_at: string | null;
  last_synced_at: string | null;
  next_scan_at: string | null;

  last_error: string | null;
  last_error_at: string | null;
  consecutive_failures: number;

  created_at: string;
  updated_at: string;
}

export interface MangaSource {
  id: string;
  manga_registry_id: string;
  source_url: string;
  source_domain: string;
  manga_slug: string;
  priority: number;
  is_enabled: boolean;
  last_chapter_count: number | null;
  last_chapter_number: number | null;
  last_scan_status: string | null;
  last_scan_error: string | null;
  last_scan_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface MangaRegistryWithSources extends MangaRegistry {
  sources: MangaSource[];
}

export type MangaStatus = 'idle' | 'scanning' | 'syncing' | 'error';

// --- Manga Sync Tasks ---

export interface MangaSyncTask {
  id: string;
  manga_registry_id: string;
  source_id: string | null;

  chapter_url: string;
  chapter_number: number;
  weight: number;

  status: SyncTaskStatus;
  zip_url: string | null;
  error: string | null;
  retry_count: number;

  created_at: string;
  updated_at: string;
}

export type SyncTaskStatus =
  | 'pending'
  | 'scraping'
  | 'scraped'
  | 'uploading'
  | 'completed'
  | 'failed'
  | 'skipped';

// --- Source Domains ---

export interface SourceDomain {
  domain: string;
  delay_between_chapters_ms: number;
  max_concurrent_chapters: number;
  is_active: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// --- API Response Types ---

export interface ApiResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  page_size: number;
}

// --- Scraper API Types (https://scraper.shinigami.io) ---

export interface ScraperMangaMetadata {
  link: string;
  cover: string;
  title: string;
  description: string;
  originTitle: string;
  release: string;
  authors: string[];
  artists: string[];
  tags: string[];
  genres: string[];
  MangaType: string;
  status: string;
}

export interface ScraperChapterSummary {
  total: number;
  lastChapter: {
    number: number;
    title: string;
    url: string;
  };
  firstChapter: {
    number: number;
    title: string;
    url: string;
  };
}

export interface ScraperMangaDetailResponse {
  metadata: ScraperMangaMetadata;
  chapters: {
    status: 'not_cached' | 'loading' | 'ready';
    total: number;
    cachedAt: number | null;
    hasCache: boolean;
  };
  chapterSummary: ScraperChapterSummary;
}

export interface ScraperChapterListItem {
  title: string;
  url: string;
  date: string;
  weight?: number;
}

export interface ScraperChapterListResponse {
  status: 'ready' | 'loading' | 'not_cached';
  page: number;
  limit: number;
  total: number;
  hasMore: boolean;
  cachedAt: number | null;
  data: ScraperChapterListItem[];
}

export interface ScraperChapterDetailImage {
  index: number;
  download_url: string;
}

// The API returns an array directly, not wrapped in an object
export type ScraperChapterDetailResponse = ScraperChapterDetailImage[];

export interface ScraperUploadChapterResponse {
  success: boolean;
  message: string;
  data: {
    publicUrl: string;
    fileName: string;
    totalImages: number;
  };
}

// --- Backend API Types (https://api.shngm.io/v1) ---

export interface BackendResponse<T = unknown> {
  retcode: number;
  message: string;
  data: T;
  error?: string;
  meta?: {
    page: number;
    page_size: number;
    total_page: number;
    total_record: number;
  };
}

export interface BackendChapter {
  chapter_id: string;
  manga_id: string;
  chapter_number: number;
  chapter_title: string;
  thumbnail_image_url: string;
  view_count: number;
  release_date: string;
}

// --- Uploader API Types ---

export interface UploaderResponse {
  message: string;
  results: {
    manga_id: string;
    chapter_number: string;
    chapter_id: string;
    data: string[];
    path: string;
  };
  info?: Array<{
    type: string;
    message: string;
  }>;
}
