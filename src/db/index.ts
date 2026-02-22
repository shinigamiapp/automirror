import Database from 'better-sqlite3';
import { CONFIG } from '../config.js';
import { runMigrations } from './migrations/001_initial.js';

let db: Database.Database | null = null;

export function getDatabase(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return db;
}

export function initDatabase(dbPath?: string): Database.Database {
  const path = dbPath ?? CONFIG.DATABASE_PATH;

  db = new Database(path);

  // Enable WAL mode for better concurrent read/write performance
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 5000');
  db.pragma('synchronous = NORMAL');
  db.pragma('foreign_keys = ON');

  // Run migrations
  runMigrations(db);

  return db;
}

export function closeDatabase(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function recoverStaleTasks(database: Database.Database): void {
  // 1. Reset stuck manga sync tasks
  database.prepare(`
    UPDATE manga_sync_tasks
    SET status = CASE
      WHEN zip_url IS NOT NULL THEN 'scraped'
      ELSE 'pending'
    END,
    updated_at = datetime('now')
    WHERE status IN ('scraping', 'uploading')
  `).run();

  // 2. Reset stuck manga status based on remaining tasks
  database.prepare(`
    UPDATE manga_registry
    SET status = CASE
      WHEN (SELECT COUNT(*) FROM manga_sync_tasks
            WHERE manga_registry_id = manga_registry.id
            AND status IN ('pending', 'scraped')) > 0
      THEN 'syncing'
      WHEN (SELECT COUNT(*) FROM manga_sync_tasks
            WHERE manga_registry_id = manga_registry.id
            AND status = 'failed') > 0
      THEN 'error'
      ELSE 'idle'
    END,
    updated_at = datetime('now')
    WHERE status IN ('scanning', 'syncing')
  `).run();
}
