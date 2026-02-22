import type Database from 'better-sqlite3';

export function runMigrations(db: Database.Database): void {
  db.exec(`
    -- Manga Registry (Primary - Single Source of Truth)
    CREATE TABLE IF NOT EXISTS manga_registry (
      id TEXT PRIMARY KEY,
      manga_id TEXT NOT NULL UNIQUE,
      manga_url TEXT NOT NULL,
      source_domain TEXT NOT NULL,
      manga_slug TEXT NOT NULL,
      series_title TEXT NOT NULL,

      auto_sync_enabled INTEGER NOT NULL DEFAULT 1,
      check_interval_minutes INTEGER NOT NULL DEFAULT 360,
      priority INTEGER NOT NULL DEFAULT 0,

      source_chapter_count INTEGER NOT NULL DEFAULT 0,
      source_last_chapter REAL,

      backend_chapter_count INTEGER NOT NULL DEFAULT 0,
      backend_last_chapter REAL,

      status TEXT NOT NULL DEFAULT 'idle',
      sync_progress_total INTEGER NOT NULL DEFAULT 0,
      sync_progress_completed INTEGER NOT NULL DEFAULT 0,
      sync_progress_failed INTEGER NOT NULL DEFAULT 0,

      last_scanned_at TEXT,
      last_synced_at TEXT,
      next_scan_at TEXT,

      last_error TEXT,
      last_error_at TEXT,
      consecutive_failures INTEGER NOT NULL DEFAULT 0,

      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE UNIQUE INDEX IF NOT EXISTS idx_manga_registry_manga_id
      ON manga_registry(manga_id);
    CREATE INDEX IF NOT EXISTS idx_manga_registry_domain_slug
      ON manga_registry(source_domain, manga_slug);
    CREATE INDEX IF NOT EXISTS idx_manga_registry_scan
      ON manga_registry(auto_sync_enabled, next_scan_at);
    CREATE INDEX IF NOT EXISTS idx_manga_registry_status
      ON manga_registry(status);

    -- Manga Sync Tasks (Internal - Not Exposed via API)
    CREATE TABLE IF NOT EXISTS manga_sync_tasks (
      id TEXT PRIMARY KEY,
      manga_registry_id TEXT NOT NULL,

      chapter_url TEXT NOT NULL,
      chapter_number REAL NOT NULL,
      weight INTEGER NOT NULL DEFAULT 0,

      status TEXT NOT NULL DEFAULT 'pending',
      zip_url TEXT,
      error TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,

      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),

      FOREIGN KEY (manga_registry_id) REFERENCES manga_registry(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_sync_tasks_manga
      ON manga_sync_tasks(manga_registry_id);
    CREATE INDEX IF NOT EXISTS idx_sync_tasks_status
      ON manga_sync_tasks(manga_registry_id, status, weight);

    -- Source Domains (Per-Domain Rate Limits)
    CREATE TABLE IF NOT EXISTS source_domains (
      domain TEXT PRIMARY KEY,
      delay_between_chapters_ms INTEGER NOT NULL DEFAULT 1000,
      max_concurrent_chapters INTEGER NOT NULL DEFAULT 3,
      is_active INTEGER NOT NULL DEFAULT 1,
      notes TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
}
