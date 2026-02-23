import { randomUUID } from 'node:crypto';
import type { PoolConnection, ResultSetHeader, RowDataPacket } from 'mysql2/promise';
import { getDatabase } from '../index.js';
import type {
  MangaRegistry,
  MangaRegistryWithSources,
  MangaSource,
  MangaSyncTask,
} from '../../types.js';

export function extractDomainAndSlug(url: string): { domain: string; slug: string } {
  const parsed = new URL(url);
  const domain = parsed.hostname;
  // Extract slug from path: /manga/some-slug/ -> some-slug
  const pathParts = parsed.pathname.split('/').filter(Boolean);
  const slug = pathParts[pathParts.length - 1] || pathParts[pathParts.length - 2] || domain;
  return { domain, slug };
}

function mapMangaSourceRow(row: RowDataPacket): MangaSource {
  return {
    id: String(row.id),
    manga_registry_id: String(row.manga_registry_id),
    source_url: String(row.source_url),
    source_domain: String(row.source_domain),
    manga_slug: String(row.manga_slug),
    priority: Number(row.priority),
    is_enabled: Number(row.is_enabled) === 1,
    last_chapter_count: row.last_chapter_count === null ? null : Number(row.last_chapter_count),
    last_chapter_number: row.last_chapter_number === null ? null : Number(row.last_chapter_number),
    last_scan_status: row.last_scan_status === null ? null : String(row.last_scan_status),
    last_scan_error: row.last_scan_error === null ? null : String(row.last_scan_error),
    last_scan_at: row.last_scan_at === null ? null : String(row.last_scan_at),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export function normalizeSourceUrls(urls: string[]): string[] {
  const normalized = urls
    .map((url) => url.trim())
    .filter((url) => url.length > 0)
    .map((url) => {
      const parsed = new URL(url);
      return parsed.toString();
    });

  const deduplicated = Array.from(new Set(normalized));

  if (deduplicated.length < 1 || deduplicated.length > 3) {
    throw new Error('source_urls must contain between 1 and 3 unique URLs');
  }

  return deduplicated;
}

function getRequestedSourceUrls(input: { source_urls?: string[]; manga_url?: string }): string[] {
  if (Array.isArray(input.source_urls)) {
    return normalizeSourceUrls(input.source_urls);
  }
  if (typeof input.manga_url === 'string' && input.manga_url.length > 0) {
    return normalizeSourceUrls([input.manga_url]);
  }
  throw new Error('source_urls is required');
}

async function replaceSources(
  connection: PoolConnection,
  mangaRegistryId: string,
  sourceUrls: string[],
): Promise<void> {
  await connection.execute(
    'DELETE FROM manga_sources WHERE manga_registry_id = ?',
    [mangaRegistryId],
  );

  for (const [index, sourceUrl] of sourceUrls.entries()) {
    const { domain, slug } = extractDomainAndSlug(sourceUrl);
    await connection.execute(
      `INSERT INTO manga_sources
       (id, manga_registry_id, source_url, source_domain, manga_slug, priority, is_enabled)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [randomUUID(), mangaRegistryId, sourceUrl, domain, slug, index + 1],
    );
  }
}

async function getSourcesByMangaIds(
  mangaRegistryIds: string[],
  options?: { enabledOnly?: boolean },
): Promise<Map<string, MangaSource[]>> {
  const sourceMap = new Map<string, MangaSource[]>();
  if (mangaRegistryIds.length === 0) return sourceMap;

  const db = getDatabase();
  const placeholders = mangaRegistryIds.map(() => '?').join(', ');
  const enabledClause = options?.enabledOnly ? 'AND is_enabled = 1' : '';
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM manga_sources
     WHERE manga_registry_id IN (${placeholders})
       ${enabledClause}
     ORDER BY manga_registry_id ASC, priority ASC`,
    mangaRegistryIds,
  );

  for (const row of rows) {
    const source = mapMangaSourceRow(row);
    const list = sourceMap.get(source.manga_registry_id) ?? [];
    list.push(source);
    sourceMap.set(source.manga_registry_id, list);
  }

  return sourceMap;
}

async function attachSources(records: MangaRegistry[]): Promise<MangaRegistryWithSources[]> {
  if (records.length === 0) return [];
  const sourceMap = await getSourcesByMangaIds(records.map((record) => record.id));
  return records.map((record) => ({
    ...record,
    sources: sourceMap.get(record.id) ?? [],
  }));
}

export function replaceHostnameOnly(url: string, oldDomain: string, newDomain: string): string {
  const parsed = new URL(url);
  if (parsed.hostname.toLowerCase() !== oldDomain.toLowerCase()) {
    return url;
  }
  parsed.hostname = newDomain;
  return parsed.toString();
}

export async function createManga(data: {
  manga_id: string;
  source_urls?: string[];
  manga_url?: string;
  series_title: string;
  check_interval_minutes?: number;
  priority?: number;
  auto_sync_enabled?: boolean;
}): Promise<MangaRegistryWithSources> {
  const db = getDatabase();
  const id = randomUUID();
  const sourceUrls = getRequestedSourceUrls(data);
  const primarySource = sourceUrls[0];
  const { domain, slug } = extractDomainAndSlug(primarySource);
  const connection = await db.getConnection();

  try {
    await connection.beginTransaction();

    await connection.execute(
      `INSERT INTO manga_registry (id, manga_id, manga_url, source_domain, manga_slug, series_title, check_interval_minutes, priority, auto_sync_enabled, next_scan_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        id,
        data.manga_id,
        primarySource,
        domain,
        slug,
        data.series_title,
        data.check_interval_minutes ?? 360,
        data.priority ?? 0,
        data.auto_sync_enabled === false ? 0 : 1,
      ],
    );

    await replaceSources(connection, id, sourceUrls);
    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  return (await getMangaById(id))!;
}

export async function getMangaById(id: string): Promise<MangaRegistryWithSources | undefined> {
  const db = getDatabase();
  const [rows] = await db.execute<RowDataPacket[]>(
    'SELECT * FROM manga_registry WHERE id = ?',
    [id],
  );
  const manga = rows[0] as MangaRegistry | undefined;
  if (!manga) return undefined;
  const [withSources] = await attachSources([manga]);
  return withSources;
}

export async function getMangaByMangaId(mangaId: string): Promise<MangaRegistryWithSources | undefined> {
  const db = getDatabase();
  const [rows] = await db.execute<RowDataPacket[]>(
    'SELECT * FROM manga_registry WHERE manga_id = ?',
    [mangaId],
  );
  const manga = rows[0] as MangaRegistry | undefined;
  if (!manga) return undefined;
  const [withSources] = await attachSources([manga]);
  return withSources;
}

export async function listManga(options: {
  status?: string;
  title_query?: string;
  page: number;
  page_size: number;
}): Promise<{ manga: MangaRegistryWithSources[]; total: number }> {
  const db = getDatabase();
  const { status, title_query, page, page_size } = options;
  const normalizedPage = Number.isFinite(page) && page > 0 ? Math.floor(page) : 1;
  const normalizedPageSize = Number.isFinite(page_size) && page_size > 0
    ? Math.min(Math.floor(page_size), 100)
    : 20;
  const offset = (normalizedPage - 1) * normalizedPageSize;

  const whereClauses: string[] = [];
  const params: (string | number)[] = [];

  if (status) {
    whereClauses.push('status = ?');
    params.push(status);
  }

  if (title_query && title_query.trim().length > 0) {
    whereClauses.push('series_title LIKE ?');
    params.push(`%${title_query.trim()}%`);
  }

  const whereClause = whereClauses.length > 0
    ? `WHERE ${whereClauses.join(' AND ')}`
    : '';

  const [countRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) as count FROM manga_registry ${whereClause}`,
    params,
  );
  const total = Number(countRows[0].count);

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM manga_registry ${whereClause} ORDER BY priority DESC, created_at DESC LIMIT ${normalizedPageSize} OFFSET ${offset}`,
    params,
  );

  return { manga: await attachSources(rows as MangaRegistry[]), total };
}

export async function updateManga(
  id: string,
  updates: {
    check_interval_minutes?: number;
    priority?: number;
    auto_sync_enabled?: boolean;
    source_urls?: string[];
    manga_url?: string;
    series_title?: string;
  },
): Promise<MangaRegistryWithSources | undefined> {
  const db = getDatabase();
  const connection = await db.getConnection();
  const setClauses: string[] = ['updated_at = NOW()'];
  const params: (string | number | null)[] = [];
  const sourceUrls = updates.source_urls !== undefined
    ? normalizeSourceUrls(updates.source_urls)
    : (updates.manga_url !== undefined ? normalizeSourceUrls([updates.manga_url]) : undefined);

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
  if (sourceUrls) {
    const { domain, slug } = extractDomainAndSlug(sourceUrls[0]);
    setClauses.push('manga_url = ?, source_domain = ?, manga_slug = ?');
    params.push(sourceUrls[0], domain, slug);
  }
  if (updates.series_title !== undefined) {
    setClauses.push('series_title = ?');
    params.push(updates.series_title);
  }

  try {
    await connection.beginTransaction();
    params.push(id);
    const [result] = await connection.execute<ResultSetHeader>(
      `UPDATE manga_registry SET ${setClauses.join(', ')} WHERE id = ?`,
      params,
    );

    if (result.affectedRows === 0) {
      await connection.rollback();
      return undefined;
    }

    if (sourceUrls) {
      await replaceSources(connection, id, sourceUrls);
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

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
    source_last_chapter: number | null;
    next_scan_at: string;
  },
): Promise<void> {
  const db = getDatabase();
  // Only reset status to 'idle' if currently in 'scanning' — never override 'syncing'
  // to avoid a race where a re-scan clears the syncing state before tasks complete.
  await db.execute(
    `UPDATE manga_registry
     SET source_chapter_count = ?, source_last_chapter = ?,
         last_scanned_at = NOW(), next_scan_at = ?,
         consecutive_failures = 0, last_error = NULL,
         status = IF(status = 'scanning', 'idle', status),
         updated_at = NOW()
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

export async function getEnabledSources(mangaRegistryId: string): Promise<MangaSource[]> {
  const db = getDatabase();
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM manga_sources
     WHERE manga_registry_id = ? AND is_enabled = 1
     ORDER BY priority ASC`,
    [mangaRegistryId],
  );
  return rows.map(mapMangaSourceRow);
}

export async function updateSourceScanStatus(
  sourceId: string,
  status: 'success' | 'empty' | 'timeout' | 'error',
  updates?: {
    last_chapter_count?: number | null;
    last_chapter_number?: number | null;
    error?: string | null;
  },
): Promise<void> {
  const db = getDatabase();
  await db.execute(
    `UPDATE manga_sources
     SET last_scan_status = ?,
         last_scan_error = ?,
         last_scan_at = NOW(),
         last_chapter_count = COALESCE(?, last_chapter_count),
         last_chapter_number = COALESCE(?, last_chapter_number),
         updated_at = NOW()
     WHERE id = ?`,
    [
      status,
      updates?.error ?? null,
      updates?.last_chapter_count ?? null,
      updates?.last_chapter_number ?? null,
      sourceId,
    ],
  );
}

export async function updateSourceDomain(
  oldDomain: string,
  newDomain: string,
  options?: { mangaIds?: string[]; dryRun?: boolean },
): Promise<{
  affectedCount: number;
  sample?: Array<{ manga_id: string; old_url: string; new_url: string }>;
}> {
  const db = getDatabase();
  const normalizedOldDomain = oldDomain.trim().toLowerCase();
  const normalizedNewDomain = newDomain.trim().toLowerCase();
  const scopedMangaIds = (options?.mangaIds ?? []).filter((value) => value.trim().length > 0);
  const whereClauses = ['ms.source_domain = ?'];
  const params: string[] = [normalizedOldDomain];

  if (scopedMangaIds.length > 0) {
    whereClauses.push(`mr.manga_id IN (${scopedMangaIds.map(() => '?').join(', ')})`);
    params.push(...scopedMangaIds);
  }

  const whereClause = `WHERE ${whereClauses.join(' AND ')}`;

  const [countRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS count
     FROM manga_sources ms
     JOIN manga_registry mr ON mr.id = ms.manga_registry_id
     ${whereClause}`,
    params,
  );

  const affectedCount = Number(countRows[0]?.count ?? 0);

  if (options?.dryRun !== false) {
    const [sampleRows] = await db.execute<RowDataPacket[]>(
      `SELECT mr.manga_id, ms.source_url AS old_url
       FROM manga_sources ms
       JOIN manga_registry mr ON mr.id = ms.manga_registry_id
       ${whereClause}
       ORDER BY mr.created_at DESC
       LIMIT 10`,
      params,
    );

    return {
      affectedCount,
      sample: sampleRows.map((row) => ({
        manga_id: String(row.manga_id),
        old_url: String(row.old_url),
        new_url: replaceHostnameOnly(String(row.old_url), normalizedOldDomain, normalizedNewDomain),
      })),
    };
  }

  if (affectedCount === 0) {
    return { affectedCount: 0 };
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ms.id, ms.manga_registry_id, mr.manga_id, ms.source_url
     FROM manga_sources ms
     JOIN manga_registry mr ON mr.id = ms.manga_registry_id
     ${whereClause}`,
    params,
  );

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    for (const row of rows) {
      const oldUrl = String(row.source_url);
      const nextUrl = replaceHostnameOnly(oldUrl, normalizedOldDomain, normalizedNewDomain);
      const { slug } = extractDomainAndSlug(nextUrl);
      await connection.execute(
        `UPDATE manga_sources
         SET source_url = ?, source_domain = ?, manga_slug = ?, updated_at = NOW()
         WHERE id = ?`,
        [nextUrl, normalizedNewDomain, slug, String(row.id)],
      );
    }

    const touchedMangaIds = Array.from(new Set(rows.map((row) => String(row.manga_registry_id))));
    if (touchedMangaIds.length > 0) {
      const placeholders = touchedMangaIds.map(() => '?').join(', ');
      await connection.execute(
        `UPDATE manga_registry mr
         JOIN manga_sources ms
           ON ms.manga_registry_id = mr.id
          AND ms.priority = 1
         SET mr.manga_url = ms.source_url,
             mr.source_domain = ms.source_domain,
             mr.manga_slug = ms.manga_slug,
             mr.updated_at = NOW()
         WHERE mr.id IN (${placeholders})`,
        touchedMangaIds,
      );
    }

    await connection.commit();
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }

  return { affectedCount };
}

export async function updateDomain(oldDomain: string, newDomain: string): Promise<number> {
  const result = await updateSourceDomain(oldDomain, newDomain, { dryRun: false });
  return result.affectedCount;
}

// --- Sync Tasks ---

export async function createSyncTasks(
  mangaRegistryId: string,
  chapters: Array<{
    chapter_url: string;
    chapter_number: number;
    weight: number;
    source_id?: string | null;
  }>,
): Promise<void> {
  const db = getDatabase();
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();
    for (const task of chapters) {
      await connection.execute(
        `INSERT INTO manga_sync_tasks (id, manga_registry_id, source_id, chapter_url, chapter_number, weight)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE updated_at = NOW()`,
        [
          randomUUID(),
          mangaRegistryId,
          task.source_id ?? null,
          task.chapter_url,
          task.chapter_number,
          task.weight,
        ],
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
  // Note: LIMIT cannot be parameterized in mysql2 prepared statements
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM manga_sync_tasks
     WHERE manga_registry_id = ? AND status = 'pending'
     ORDER BY weight ASC
     LIMIT ${Math.floor(limit)}`,
    [mangaRegistryId],
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

export async function updateBackendChapterStats(
  id: string,
  data: { backend_chapter_count: number; backend_last_chapter: number | null },
): Promise<void> {
  const db = getDatabase();
  await db.execute(
    `UPDATE manga_registry
     SET backend_chapter_count = ?,
         backend_last_chapter = ?,
         updated_at = NOW()
     WHERE id = ?`,
    [data.backend_chapter_count, data.backend_last_chapter, id],
  );
}

export async function incrementBackendChapterStats(
  id: string,
  chapterNumber: number,
): Promise<void> {
  const db = getDatabase();
  await db.execute(
    `UPDATE manga_registry
     SET backend_chapter_count = backend_chapter_count + 1,
         backend_last_chapter = GREATEST(COALESCE(backend_last_chapter, 0), ?),
         updated_at = NOW()
     WHERE id = ?`,
    [chapterNumber, id],
  );
}

/**
 * Resolve manga stuck in 'syncing' state whose tasks have all finished.
 * This handles the edge case where all tasks complete but the manga status
 * never transitioned back because getMangaWithActiveTasks excluded it.
 */
export async function resolveCompletedSyncingManga(): Promise<number> {
  const db = getDatabase();

  // Flip to 'error' if any failed tasks remain, otherwise 'idle'
  const [errorResult] = await db.execute<ResultSetHeader>(
    `UPDATE manga_registry
     SET status = 'error',
         last_error = 'Some chapters failed to sync',
         updated_at = NOW()
     WHERE status = 'syncing'
       AND NOT EXISTS (
         SELECT 1 FROM manga_sync_tasks
         WHERE manga_registry_id = manga_registry.id
           AND status IN ('pending', 'scraping', 'scraped', 'uploading')
       )
       AND EXISTS (
         SELECT 1 FROM manga_sync_tasks
         WHERE manga_registry_id = manga_registry.id
           AND status = 'failed'
       )`,
  );

  const [idleResult] = await db.execute<ResultSetHeader>(
    `UPDATE manga_registry
     SET status = 'idle',
         last_synced_at = COALESCE(last_synced_at, NOW()),
         updated_at = NOW()
     WHERE status = 'syncing'
       AND NOT EXISTS (
         SELECT 1 FROM manga_sync_tasks
         WHERE manga_registry_id = manga_registry.id
           AND status IN ('pending', 'scraping', 'scraped', 'uploading', 'failed')
       )`,
  );

  return errorResult.affectedRows + idleResult.affectedRows;
}
