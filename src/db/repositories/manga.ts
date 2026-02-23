import { randomUUID } from 'node:crypto';
import type { ResultSetHeader, RowDataPacket } from 'mysql2/promise';
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

export async function createManga(data: {
  manga_id: string;
  manga_url: string;
  series_title: string;
  check_interval_minutes?: number;
  priority?: number;
  auto_sync_enabled?: boolean;
}): Promise<MangaRegistry> {
  const db = getDatabase();
  const id = randomUUID();
  const { domain, slug } = extractDomainAndSlug(data.manga_url);

  await db.execute(
    `INSERT INTO manga_registry (id, manga_id, manga_url, source_domain, manga_slug, series_title, check_interval_minutes, priority, auto_sync_enabled, next_scan_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
    [
      id,
      data.manga_id,
      data.manga_url,
      domain,
      slug,
      data.series_title,
      data.check_interval_minutes ?? 20,
      data.priority ?? 0,
      data.auto_sync_enabled === false ? 0 : 1,
    ],
  );

  return (await getMangaById(id))!;
}

export async function getMangaById(id: string): Promise<MangaRegistry | undefined> {
  const db = getDatabase();
  const [rows] = await db.execute<RowDataPacket[]>(
    'SELECT * FROM manga_registry WHERE id = ?',
    [id],
  );
  return rows[0] as MangaRegistry | undefined;
}

export async function getMangaByMangaId(mangaId: string): Promise<MangaRegistry | undefined> {
  const db = getDatabase();
  const [rows] = await db.execute<RowDataPacket[]>(
    'SELECT * FROM manga_registry WHERE manga_id = ?',
    [mangaId],
  );
  return rows[0] as MangaRegistry | undefined;
}

export async function listManga(options: {
  status?: string;
  page: number;
  page_size: number;
}): Promise<{ manga: MangaRegistry[]; total: number }> {
  const db = getDatabase();
  const { status, page, page_size } = options;
  const offset = (page - 1) * page_size;

  let whereClause = '';
  const params: (string | number)[] = [];

  if (status) {
    whereClause = 'WHERE status = ?';
    params.push(status);
  }

  const [countRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) as count FROM manga_registry ${whereClause}`,
    params,
  );
  const total = Number(countRows[0].count);

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM manga_registry ${whereClause} ORDER BY priority DESC, created_at DESC LIMIT ? OFFSET ?`,
    [...params, page_size, offset],
  );

  return { manga: rows as MangaRegistry[], total };
}

export async function updateManga(
  id: string,
  updates: {
    check_interval_minutes?: number;
    priority?: number;
    auto_sync_enabled?: boolean;
    manga_url?: string;
    series_title?: string;
  },
): Promise<MangaRegistry | undefined> {
  const db = getDatabase();
  const setClauses: string[] = ['updated_at = NOW()'];
  const params: (string | number | null)[] = [];

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
  const [result] = await db.execute<ResultSetHeader>(
    `UPDATE manga_registry SET ${setClauses.join(', ')} WHERE id = ?`,
    params,
  );

  if (result.affectedRows === 0) return undefined;
  return getMangaById(id);
}

export async function deleteManga(id: string): Promise<boolean> {
  const db = getDatabase();
  const [result] = await db.execute<ResultSetHeader>(
    'DELETE FROM manga_registry WHERE id = ?',
    [id],
  );
  return result.affectedRows > 0;
}

export async function updateMangaStatus(
  id: string,
  status: string,
  error?: string,
): Promise<void> {
  const db = getDatabase();
  if (error) {
    await db.execute(
      `UPDATE manga_registry
       SET status = ?, last_error = ?, last_error_at = NOW(),
           consecutive_failures = consecutive_failures + 1, updated_at = NOW()
       WHERE id = ?`,
      [status, error, id],
    );
  } else {
    await db.execute(
      `UPDATE manga_registry
       SET status = ?, updated_at = NOW()
       WHERE id = ?`,
      [status, id],
    );
  }
}

export async function updateMangaScanResult(
  id: string,
  data: {
    source_chapter_count: number;
    source_last_chapter: number;
    next_scan_at: string;
  },
): Promise<void> {
  const db = getDatabase();
  await db.execute(
    `UPDATE manga_registry
     SET source_chapter_count = ?, source_last_chapter = ?,
         last_scanned_at = NOW(), next_scan_at = ?,
         consecutive_failures = 0, last_error = NULL,
         status = 'idle', updated_at = NOW()
     WHERE id = ?`,
    [data.source_chapter_count, data.source_last_chapter, data.next_scan_at, id],
  );
}

export async function updateMangaSyncProgress(id: string): Promise<void> {
  const db = getDatabase();
  await db.execute(
    `UPDATE manga_registry
     SET sync_progress_completed = (
           SELECT COUNT(*) FROM manga_sync_tasks
           WHERE manga_registry_id = ? AND status IN ('completed', 'skipped')
         ),
         sync_progress_failed = (
           SELECT COUNT(*) FROM manga_sync_tasks
           WHERE manga_registry_id = ? AND status = 'failed'
         ),
         updated_at = NOW()
     WHERE id = ?`,
    [id, id, id],
  );
}

export async function getDueManga(): Promise<MangaRegistry[]> {
  const db = getDatabase();
  const [rows] = await db.execute<RowDataPacket[]>(`
    SELECT * FROM manga_registry
    WHERE auto_sync_enabled = 1
      AND status = 'idle'
      AND (next_scan_at IS NULL OR next_scan_at <= NOW())
    ORDER BY priority DESC, next_scan_at ASC
  `);
  return rows as MangaRegistry[];
}

export async function updateDomain(oldDomain: string, newDomain: string): Promise<number> {
  const db = getDatabase();
  const [result] = await db.execute<ResultSetHeader>(
    `UPDATE manga_registry
     SET manga_url = REPLACE(manga_url, ?, ?),
         source_domain = ?,
         updated_at = NOW()
     WHERE source_domain = ?`,
    [oldDomain, newDomain, newDomain, oldDomain],
  );
  return result.affectedRows;
}

// --- Sync Tasks ---

export async function createSyncTasks(
  mangaRegistryId: string,
  chapters: Array<{ chapter_url: string; chapter_number: number; weight: number }>,
): Promise<void> {
  const db = getDatabase();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    for (const task of chapters) {
      await connection.execute(
        `INSERT INTO manga_sync_tasks (id, manga_registry_id, chapter_url, chapter_number, weight)
         VALUES (?, ?, ?, ?, ?)`,
        [randomUUID(), mangaRegistryId, task.chapter_url, task.chapter_number, task.weight],
      );
    }
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function getPendingSyncTasks(
  mangaRegistryId: string,
  limit: number,
): Promise<MangaSyncTask[]> {
  const db = getDatabase();
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM manga_sync_tasks
     WHERE manga_registry_id = ? AND status = 'pending'
     ORDER BY weight ASC
     LIMIT ?`,
    [mangaRegistryId, limit],
  );
  return rows as MangaSyncTask[];
}

export async function getSyncTasksByManga(mangaRegistryId: string): Promise<MangaSyncTask[]> {
  const db = getDatabase();
  const [rows] = await db.execute<RowDataPacket[]>(
    'SELECT * FROM manga_sync_tasks WHERE manga_registry_id = ? ORDER BY weight ASC',
    [mangaRegistryId],
  );
  return rows as MangaSyncTask[];
}

export async function getFailedSyncTasks(mangaRegistryId: string): Promise<MangaSyncTask[]> {
  const db = getDatabase();
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT * FROM manga_sync_tasks WHERE manga_registry_id = ? AND status = 'failed' ORDER BY weight ASC",
    [mangaRegistryId],
  );
  return rows as MangaSyncTask[];
}

export async function updateSyncTaskStatus(
  id: string,
  status: string,
  updates?: { zip_url?: string; error?: string },
): Promise<void> {
  const db = getDatabase();
  await db.execute(
    `UPDATE manga_sync_tasks
     SET status = ?,
         zip_url = COALESCE(?, zip_url),
         error = ?,
         retry_count = CASE WHEN ? = 'failed' THEN retry_count + 1 ELSE retry_count END,
         updated_at = NOW()
     WHERE id = ?`,
    [status, updates?.zip_url ?? null, updates?.error ?? null, status, id],
  );
}

export async function retryFailedTasks(mangaRegistryId: string): Promise<number> {
  const db = getDatabase();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [result] = await connection.execute<ResultSetHeader>(
      `UPDATE manga_sync_tasks
       SET status = 'pending', error = NULL, updated_at = NOW()
       WHERE manga_registry_id = ? AND status = 'failed'`,
      [mangaRegistryId],
    );

    if (result.affectedRows > 0) {
      await connection.execute(
        `UPDATE manga_registry
         SET status = 'syncing', last_error = NULL, updated_at = NOW()
         WHERE id = ?`,
        [mangaRegistryId],
      );
    }

    await connection.commit();
    return result.affectedRows;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

export async function getMangaWithActiveTasks(): Promise<MangaRegistry[]> {
  const db = getDatabase();
  const [rows] = await db.execute<RowDataPacket[]>(`
    SELECT mr.* FROM manga_registry mr
    WHERE mr.status = 'syncing'
      AND EXISTS (
        SELECT 1 FROM manga_sync_tasks mst
        WHERE mst.manga_registry_id = mr.id
          AND mst.status IN ('pending', 'scraping', 'scraped', 'uploading')
      )
    ORDER BY mr.priority DESC
  `);
  return rows as MangaRegistry[];
}

export async function triggerForceScan(id: string): Promise<void> {
  const db = getDatabase();
  await db.execute(
    `UPDATE manga_registry
     SET next_scan_at = NOW(), status = 'idle', updated_at = NOW()
     WHERE id = ?`,
    [id],
  );
}

export async function incrementSyncProgressTotal(id: string, count: number): Promise<void> {
  const db = getDatabase();
  await db.execute(
    `UPDATE manga_registry
     SET sync_progress_total = sync_progress_total + ?,
         updated_at = NOW()
     WHERE id = ?`,
    [count, id],
  );
}

export async function updateLastSyncedAt(id: string): Promise<void> {
  const db = getDatabase();
  await db.execute(
    `UPDATE manga_registry
     SET last_synced_at = NOW(), updated_at = NOW()
     WHERE id = ?`,
    [id],
  );
}
