import type { Pool } from 'mysql2/promise';

export async function runMigrations(pool: Pool): Promise<void> {
  // Manga Registry (Primary - Single Source of Truth)
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS manga_registry (
      id VARCHAR(36) NOT NULL PRIMARY KEY,
      manga_id VARCHAR(255) NOT NULL UNIQUE,
      manga_url TEXT NOT NULL,
      source_domain VARCHAR(255) NOT NULL,
      manga_slug VARCHAR(255) NOT NULL,
      series_title VARCHAR(512) NOT NULL,

      auto_sync_enabled TINYINT(1) NOT NULL DEFAULT 1,
      check_interval_minutes INT NOT NULL DEFAULT 360,
      priority INT NOT NULL DEFAULT 0,

      source_chapter_count INT NOT NULL DEFAULT 0,
      source_last_chapter DOUBLE DEFAULT NULL,

      backend_chapter_count INT NOT NULL DEFAULT 0,
      backend_last_chapter DOUBLE DEFAULT NULL,

      status VARCHAR(20) NOT NULL DEFAULT 'idle',
      sync_progress_total INT NOT NULL DEFAULT 0,
      sync_progress_completed INT NOT NULL DEFAULT 0,
      sync_progress_failed INT NOT NULL DEFAULT 0,

      last_scanned_at DATETIME DEFAULT NULL,
      last_synced_at DATETIME DEFAULT NULL,
      next_scan_at DATETIME DEFAULT NULL,

      last_error TEXT DEFAULT NULL,
      last_error_at DATETIME DEFAULT NULL,
      consecutive_failures INT NOT NULL DEFAULT 0,

      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);

  await pool.execute(`
    CREATE INDEX IF NOT EXISTS idx_manga_registry_domain_slug
      ON manga_registry(source_domain, manga_slug)
  `);

  await pool.execute(`
    CREATE INDEX IF NOT EXISTS idx_manga_registry_scan
      ON manga_registry(auto_sync_enabled, next_scan_at)
  `);

  await pool.execute(`
    CREATE INDEX IF NOT EXISTS idx_manga_registry_status
      ON manga_registry(status)
  `);

  // Manga Sync Tasks (Internal - Not Exposed via API)
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS manga_sync_tasks (
      id VARCHAR(36) NOT NULL PRIMARY KEY,
      manga_registry_id VARCHAR(36) NOT NULL,

      chapter_url TEXT NOT NULL,
      chapter_number DOUBLE NOT NULL,
      weight INT NOT NULL DEFAULT 0,

      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      zip_url TEXT DEFAULT NULL,
      error TEXT DEFAULT NULL,
      retry_count INT NOT NULL DEFAULT 0,

      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

      FOREIGN KEY (manga_registry_id) REFERENCES manga_registry(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);

  await pool.execute(`
    CREATE INDEX IF NOT EXISTS idx_sync_tasks_manga
      ON manga_sync_tasks(manga_registry_id)
  `);

  await pool.execute(`
    CREATE INDEX IF NOT EXISTS idx_sync_tasks_status
      ON manga_sync_tasks(manga_registry_id, status, weight)
  `);

  // Source Domains (Per-Domain Rate Limits)
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS source_domains (
      domain VARCHAR(255) NOT NULL PRIMARY KEY,
      delay_between_chapters_ms INT NOT NULL DEFAULT 1000,
      max_concurrent_chapters INT NOT NULL DEFAULT 3,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      notes TEXT DEFAULT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB
  `);
}
