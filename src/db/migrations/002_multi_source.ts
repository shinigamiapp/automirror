import type { Pool, RowDataPacket } from 'mysql2/promise';

async function createIndexIfNotExists(pool: Pool, sql: string): Promise<void> {
  try {
    await pool.execute(sql);
  } catch (error: unknown) {
    const mysqlError = error as { code?: string; errno?: number };
    if (mysqlError.code === 'ER_DUP_KEYNAME' || mysqlError.errno === 1061) {
      return;
    }
    throw error;
  }
}

async function addColumnIfMissing(
  pool: Pool,
  tableName: string,
  columnName: string,
  columnDefinitionSql: string,
): Promise<void> {
  const [rows] = await pool.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS count
     FROM information_schema.columns
     WHERE table_schema = DATABASE()
       AND table_name = ?
       AND column_name = ?`,
    [tableName, columnName],
  );

  if (Number(rows[0]?.count ?? 0) > 0) {
    return;
  }

  await pool.execute(`ALTER TABLE ${tableName} ADD COLUMN ${columnDefinitionSql}`);
}

export async function runMigration(pool: Pool): Promise<void> {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS manga_sources (
      id VARCHAR(36) NOT NULL PRIMARY KEY,
      manga_registry_id VARCHAR(36) NOT NULL,

      source_url TEXT NOT NULL,
      source_domain VARCHAR(255) NOT NULL,
      manga_slug VARCHAR(255) NOT NULL,
      priority TINYINT NOT NULL DEFAULT 1,
      is_enabled TINYINT(1) NOT NULL DEFAULT 1,

      last_chapter_count INT DEFAULT NULL,
      last_chapter_number DOUBLE DEFAULT NULL,
      last_scan_status VARCHAR(20) DEFAULT NULL,
      last_scan_error TEXT DEFAULT NULL,
      last_scan_at DATETIME DEFAULT NULL,

      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

      FOREIGN KEY (manga_registry_id) REFERENCES manga_registry(id) ON DELETE CASCADE
    ) ENGINE=InnoDB
  `);

  await createIndexIfNotExists(
    pool,
    'CREATE UNIQUE INDEX idx_manga_source_url ON manga_sources(manga_registry_id, source_url)',
  );
  await createIndexIfNotExists(pool, 'CREATE INDEX idx_source_domain ON manga_sources(source_domain)');
  await createIndexIfNotExists(pool, 'CREATE INDEX idx_manga_priority ON manga_sources(manga_registry_id, priority)');

  await pool.execute(`
    INSERT INTO manga_sources (id, manga_registry_id, source_url, source_domain, manga_slug, priority, is_enabled)
    SELECT UUID(), id, manga_url, source_domain, manga_slug, 1, 1
    FROM manga_registry
    WHERE manga_url IS NOT NULL AND manga_url != ''
    ON DUPLICATE KEY UPDATE
      source_domain = VALUES(source_domain),
      manga_slug = VALUES(manga_slug),
      updated_at = NOW()
  `);

  await addColumnIfMissing(
    pool,
    'manga_sync_tasks',
    'source_id',
    'source_id VARCHAR(36) DEFAULT NULL',
  );

  // Remove duplicate tasks before adding unique index.
  await pool.execute(`
    DELETE mst1 FROM manga_sync_tasks mst1
    INNER JOIN manga_sync_tasks mst2
      ON mst1.manga_registry_id = mst2.manga_registry_id
      AND mst1.chapter_number = mst2.chapter_number
      AND mst1.id > mst2.id
  `);

  await createIndexIfNotExists(
    pool,
    'CREATE UNIQUE INDEX idx_sync_tasks_manga_chapter ON manga_sync_tasks(manga_registry_id, chapter_number)',
  );
  await createIndexIfNotExists(pool, 'CREATE INDEX idx_sync_tasks_source_id ON manga_sync_tasks(source_id)');
}
