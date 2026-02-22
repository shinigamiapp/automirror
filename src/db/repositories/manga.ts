import { randomUUID } from 'node:crypto';
import { getDatabase } from '../index.js';
import type { MangaRegistry, MangaSyncTask } from '../../types.js';

function extractDomainAndSlug(url: string): { domain: string; slug: string } {
  const parsed = new URL(url);
  const domain = parsed.hostname;
  // Extract slug from path: /manga/some-slug/ -> some-slug
  const pathParts = parsed.pathname.split('/').filter(Boolean);
  const slug = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2] || domain;
  return { domain, slug };
}

export function createManga(data: {
  manga_id: string;
  manga_url: string;
  series_title: string;
  check_interval_minutes?: number;
  priority?: number;
  auto_sync_enabled?: boolean;
}): MangaRegistry {
  const db = getDatabase();
  const id = randomUUID();
  const { domain, slug } = extractDomainAndSlug(data.manga_url);

  db.prepare(`
    INSERT INTO manga_registry (id, manga_id, manga_url, source_domain, manga_slug, series_title, check_interval_minutes, priority, auto_sync_enabled, next_scan_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    id,
    data.manga_id,
    data.manga_url,
    domain,
    slug,
    data.series_title,
    data.check_interval_minutes ?? 360,
    data.priority ?? 0,
    data.auto_sync_enabled === false ? 0 : 1,
  );

  return getMangaById(id)!;
}

export function getMangaById(id: string): MangaRegistry | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM manga_registry WHERE id = ?').get(id) as MangaRegistry | undefined;
}

export function getMangaByMangaId(mangaId: string): MangaRegistry | undefined {
  const db = getDatabase();
  return db.prepare('SELECT * FROM manga_registry WHERE manga_id = ?').get(mangaId) as MangaRegistry | undefined;
}

export function listManga(options: {
  status?: string;
  page: number;
  page_size: number;
}): { manga: MangaRegistry[]; total: number } {
  const db = getDatabase();
  const { status, page, page_size } = options;
  const offset = (page - 1) * page_size;

  let whereClause = '';
  const params: unknown[] = [];

  if (status) {
    whereClause = 'WHERE status = ?';
    params.push(status);
  }

  const total = db.prepare(
    `SELECT COUNT(*) as count FROM manga_registry ${whereClause}`,
  ).get(...params) as { count: number };

  const manga = db.prepare(
    `SELECT * FROM manga_registry ${whereClause} ORDER BY priority DESC, created_at DESC LIMIT ? OFFSET ?`,
  ).all(...params, page_size, offset) as MangaRegistry[];

  return { manga, total: total.count };
}

export function updateManga(
  id: string,
  updates: {
    check_interval_minutes?: number;
    priority?: number;
    auto_sync_enabled?: boolean;
    manga_url?: string;
    series_title?: string;
  },
): MangaRegistry | undefined {
  const db = getDatabase();
  const setClauses: string[] = ["updated_at = datetime('now')"];
  const params: unknown[] = [];

  if (updates.check_interval_minutes !== undefined) {
    setClauses.push('check_interval_minutes = ?');
    params.push(updates.check_interval_minutes);
  }
  if (updates.priority !== undefined) {
    setClauses.push('priority = ?');
    params.push(updates.priority);
  }
  if (updates.auto_sync_enabled !== undefined) {
    setClauses.push('auto_sync_enabled = ?');
    params.push(updates.auto_sync_enabled ? 1 : 0);
  }
  if (updates.manga_url !== undefined) {
    const { domain, slug } = extractDomainAndSlug(updates.manga_url);
    setClauses.push('manga_url = ?, source_domain = ?, manga_slug = ?');
    params.push(updates.manga_url, domain, slug);
  }
  if (updates.series_title !== undefined) {
    setClauses.push('series_title = ?');
    params.push(updates.series_title);
  }

  params.push(id);
  const result = db.prepare(
    `UPDATE manga_registry SET ${setClauses.join(', ')} WHERE id = ?`,
  ).run(...params);

  if (result.changes === 0) return undefined;
  return getMangaById(id);
}

export function deleteManga(id: string): boolean {
  const db = getDatabase();
  const result = db.prepare('DELETE FROM manga_registry WHERE id = ?').run(id);
  return result.changes > 0;
}

export function updateMangaStatus(
  id: string,
  status: string,
  error?: string,
): void {
  const db = getDatabase();
  if (error) {
    db.prepare(`
      UPDATE manga_registry
      SET status = ?, last_error = ?, last_error_at = datetime('now'),
          consecutive_failures = consecutive_failures + 1, updated_at = datetime('now')
      WHERE id = ?
    `).run(status, error, id);
  } else {
    db.prepare(`
      UPDATE manga_registry
      SET status = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(status, id);
  }
}

export function updateMangaScanResult(
  id: string,
  data: {
    source_chapter_count: number;
    source_last_chapter: number;
    next_scan_at: string;
  },
): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE manga_registry
    SET source_chapter_count = ?, source_last_chapter = ?,
        last_scanned_at = datetime('now'), next_scan_at = ?,
        consecutive_failures = 0, last_error = NULL,
        status = 'idle', updated_at = datetime('now')
    WHERE id = ?
  `).run(data.source_chapter_count, data.source_last_chapter, data.next_scan_at, id);
}

export function updateMangaSyncProgress(id: string): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE manga_registry
    SET sync_progress_completed = (
          SELECT COUNT(*) FROM manga_sync_tasks
          WHERE manga_registry_id = ? AND status IN ('completed', 'skipped')
        ),
        sync_progress_failed = (
          SELECT COUNT(*) FROM manga_sync_tasks
          WHERE manga_registry_id = ? AND status = 'failed'
        ),
        updated_at = datetime('now')
    WHERE id = ?
  `).run(id, id, id);
}

export function getDueManga(): MangaRegistry[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT * FROM manga_registry
    WHERE auto_sync_enabled = 1
      AND status = 'idle'
      AND (next_scan_at IS NULL OR next_scan_at <= datetime('now'))
    ORDER BY priority DESC, next_scan_at ASC
  `).all() as MangaRegistry[];
}

export function updateDomain(oldDomain: string, newDomain: string): number {
  const db = getDatabase();
  const result = db.prepare(`
    UPDATE manga_registry
    SET manga_url = REPLACE(manga_url, ?, ?),
        source_domain = ?,
        updated_at = datetime('now')
    WHERE source_domain = ?
  `).run(oldDomain, newDomain, newDomain, oldDomain);
  return result.changes;
}

// --- Sync Tasks ---

export function createSyncTasks(
  mangaRegistryId: string,
  chapters: Array<{ chapter_url: string; chapter_number: number; weight: number }>,
): void {
  const db = getDatabase();
  const insert = db.prepare(`
    INSERT INTO manga_sync_tasks (id, manga_registry_id, chapter_url, chapter_number, weight)
    VALUES (?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction((tasks: typeof chapters) => {
    for (const task of tasks) {
      insert.run(randomUUID(), mangaRegistryId, task.chapter_url, task.chapter_number, task.weight);
    }
  });

  insertMany(chapters);
}

export function getPendingSyncTasks(
  mangaRegistryId: string,
  limit: number,
): MangaSyncTask[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT * FROM manga_sync_tasks
    WHERE manga_registry_id = ? AND status = 'pending'
    ORDER BY weight ASC
    LIMIT ?
  `).all(mangaRegistryId, limit) as MangaSyncTask[];
}

export function getSyncTasksByManga(mangaRegistryId: string): MangaSyncTask[] {
  const db = getDatabase();
  return db.prepare(
    'SELECT * FROM manga_sync_tasks WHERE manga_registry_id = ? ORDER BY weight ASC',
  ).all(mangaRegistryId) as MangaSyncTask[];
}

export function getFailedSyncTasks(mangaRegistryId: string): MangaSyncTask[] {
  const db = getDatabase();
  return db.prepare(
    "SELECT * FROM manga_sync_tasks WHERE manga_registry_id = ? AND status = 'failed' ORDER BY weight ASC",
  ).all(mangaRegistryId) as MangaSyncTask[];
}

export function updateSyncTaskStatus(
  id: string,
  status: string,
  updates?: { zip_url?: string; error?: string },
): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE manga_sync_tasks
    SET status = ?,
        zip_url = COALESCE(?, zip_url),
        error = ?,
        retry_count = CASE WHEN ? = 'failed' THEN retry_count + 1 ELSE retry_count END,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(status, updates?.zip_url ?? null, updates?.error ?? null, status, id);
}

export function retryFailedTasks(mangaRegistryId: string): number {
  const db = getDatabase();
  const result = db.prepare(`
    UPDATE manga_sync_tasks
    SET status = 'pending', error = NULL, updated_at = datetime('now')
    WHERE manga_registry_id = ? AND status = 'failed'
  `).run(mangaRegistryId);

  if (result.changes > 0) {
    db.prepare(`
      UPDATE manga_registry
      SET status = 'syncing', last_error = NULL, updated_at = datetime('now')
      WHERE id = ?
    `).run(mangaRegistryId);
  }

  return result.changes;
}

export function getMangaWithActiveTasks(): MangaRegistry[] {
  const db = getDatabase();
  return db.prepare(`
    SELECT mr.* FROM manga_registry mr
    WHERE mr.status = 'syncing'
      AND EXISTS (
        SELECT 1 FROM manga_sync_tasks mst
        WHERE mst.manga_registry_id = mr.id
          AND mst.status IN ('pending', 'scraping', 'scraped', 'uploading')
      )
    ORDER BY mr.priority DESC
  `).all() as MangaRegistry[];
}

export function triggerForceScan(id: string): void {
  const db = getDatabase();
  db.prepare(`
    UPDATE manga_registry
    SET next_scan_at = datetime('now'), status = 'idle', updated_at = datetime('now')
    WHERE id = ?
  `).run(id);
}
