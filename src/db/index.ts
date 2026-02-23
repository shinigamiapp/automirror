import mysql, { type Pool } from 'mysql2/promise';
import { CONFIG } from '../config.js';
import { runMigrations } from './migrations/001_initial.js';
import { runMigration as runMultiSourceMigration } from './migrations/002_multi_source.js';

let pool: Pool | null = null;

export function getDatabase(): Pool {
  if (!pool) {
    throw new Error('Database not initialized. Call initDatabase() first.');
  }
  return pool;
}

export async function initDatabase(): Promise<Pool> {
  pool = mysql.createPool({
    host: CONFIG.MYSQL_HOST,
    port: CONFIG.MYSQL_PORT,
    user: CONFIG.MYSQL_USER,
    password: CONFIG.MYSQL_PASSWORD,
    database: CONFIG.MYSQL_DATABASE,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
    dateStrings: true,
    timezone: '+00:00',
    supportBigNumbers: true,
    bigNumberStrings: false,
  });

  // Verify connection
  const connection = await pool.getConnection();
  connection.release();

  // Run migrations
  await runMigrations(pool);
  await runMultiSourceMigration(pool);

  return pool;
}

export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

export async function recoverStaleTasks(): Promise<void> {
  const db = getDatabase();

  // 1. Reset stuck manga sync tasks
  await db.execute(`
    UPDATE manga_sync_tasks
    SET status = CASE
      WHEN zip_url IS NOT NULL THEN 'scraped'
      ELSE 'pending'
    END,
    updated_at = NOW()
    WHERE status IN ('scraping', 'uploading')
  `);

  // 2. Reset stuck manga status based on remaining tasks
  await db.execute(`
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
    last_synced_at = CASE
      WHEN (SELECT COUNT(*) FROM manga_sync_tasks
            WHERE manga_registry_id = manga_registry.id
            AND status IN ('pending', 'scraped', 'failed')) = 0
      THEN COALESCE(last_synced_at, NOW())
      ELSE last_synced_at
    END,
    updated_at = NOW()
    WHERE status IN ('scanning', 'syncing')
  `);
}
