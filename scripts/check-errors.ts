import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: '127.0.0.1',
  port: 3306,
  user: 'automirror',
  password: 'v1gsFRAISWKkLR/LwMyL+u9T9odbA7gN',
  database: 'automirror',
  dateStrings: true,
});

async function main() {
  const mangaId = '23f49c2e-cf89-44f6-b39a-773e65cfcd60';
  
  console.log('=== Checking manga_registry for manga_id:', mangaId, '===\n');
  
  // Find the manga registry entry
  const [mangaRows] = await pool.execute(
    'SELECT * FROM manga_registry WHERE manga_id = ?',
    [mangaId]
  );
  
  if ((mangaRows as any[]).length === 0) {
    console.log('No manga registry found for manga_id:', mangaId);
  } else {
    const manga = (mangaRows as any[])[0];
    console.log('Manga Registry:');
    console.log('  ID:', manga.id);
    console.log('  Title:', manga.series_title);
    console.log('  Status:', manga.status);
    console.log('  Last Error:', manga.last_error);
    console.log('  Last Error At:', manga.last_error_at);
    console.log('  Consecutive Failures:', manga.consecutive_failures);
    console.log('');
  }
  
  // Find all failed sync tasks for this manga
  console.log('=== Failed Sync Tasks for manga_id:', mangaId, '===\n');
  
  const [failedTasks] = await pool.execute(`
    SELECT mst.* FROM manga_sync_tasks mst
    JOIN manga_registry mr ON mst.manga_registry_id = mr.id
    WHERE mr.manga_id = ? AND mst.status = 'failed'
    ORDER BY mst.chapter_number ASC
  `, [mangaId]);
  
  const tasks = failedTasks as any[];
  console.log(`Found ${tasks.length} failed tasks:\n`);
  
  for (const task of tasks) {
    console.log(`Chapter ${task.chapter_number}:`);
    console.log(`  Task ID: ${task.id}`);
    console.log(`  URL: ${task.chapter_url}`);
    console.log(`  Error: ${task.error}`);
    console.log(`  Retry Count: ${task.retry_count}`);
    console.log(`  Updated At: ${task.updated_at}`);
    console.log('');
  }
  
  // Find ALL manga with HTTP 400 errors
  console.log('=== All Manga with HTTP 400 Bad Request Errors ===\n');
  
  const [allErrors] = await pool.execute(`
    SELECT mr.id, mr.manga_id, mr.series_title, mr.status, mr.last_error,
           COUNT(mst.id) as failed_task_count
    FROM manga_registry mr
    LEFT JOIN manga_sync_tasks mst ON mst.manga_registry_id = mr.id AND mst.status = 'failed'
    WHERE mr.last_error LIKE '%400%' 
       OR mr.last_error LIKE '%Bad Request%'
       OR mst.error LIKE '%400%'
       OR mst.error LIKE '%Bad Request%'
    GROUP BY mr.id
    ORDER BY failed_task_count DESC
  `);
  
  const errorManga = allErrors as any[];
  console.log(`Found ${errorManga.length} manga with HTTP 400 errors:\n`);
  
  for (const m of errorManga) {
    console.log(`${m.series_title}:`);
    console.log(`  Registry ID: ${m.id}`);
    console.log(`  Manga ID: ${m.manga_id}`);
    console.log(`  Status: ${m.status}`);
    console.log(`  Failed Tasks: ${m.failed_task_count}`);
    console.log(`  Last Error: ${m.last_error}`);
    console.log('');
  }

  // Get detailed error breakdown
  console.log('=== Detailed Error Breakdown (All Failed Tasks with 400 errors) ===\n');
  
  const [detailedErrors] = await pool.execute(`
    SELECT mst.id, mst.chapter_number, mst.error, mst.retry_count,
           mr.series_title, mr.manga_id
    FROM manga_sync_tasks mst
    JOIN manga_registry mr ON mst.manga_registry_id = mr.id
    WHERE mst.status = 'failed' 
      AND (mst.error LIKE '%400%' OR mst.error LIKE '%Bad Request%')
    ORDER BY mr.series_title, mst.chapter_number
  `);
  
  const detailed = detailedErrors as any[];
  console.log(`Found ${detailed.length} failed tasks with HTTP 400 errors:\n`);
  
  for (const d of detailed) {
    console.log(`[${d.series_title}] Chapter ${d.chapter_number}:`);
    console.log(`  Task ID: ${d.id}`);
    console.log(`  Manga ID: ${d.manga_id}`);
    console.log(`  Error: ${d.error}`);
    console.log(`  Retries: ${d.retry_count}`);
    console.log('');
  }

  // Check the chapter URLs for all chapter 0 tasks
  console.log('=== Chapter URLs for Chapter 0 Tasks ===\n');
  
  const [chapterZeroTasks] = await pool.execute(`
    SELECT mst.id, mst.chapter_url, mst.chapter_number, mst.error,
           mr.series_title, mr.manga_id
    FROM manga_sync_tasks mst
    JOIN manga_registry mr ON mst.manga_registry_id = mr.id
    WHERE mst.chapter_number = 0
    ORDER BY mr.series_title
  `);
  
  const zeroTasks = chapterZeroTasks as any[];
  console.log(`Found ${zeroTasks.length} tasks with chapter_number = 0:\n`);
  
  for (const t of zeroTasks) {
    console.log(`[${t.series_title}]:`);
    console.log(`  URL: ${t.chapter_url}`);
    console.log(`  Status: ${t.error ? 'failed' : 'other'}`);
    console.log('');
  }

  await pool.end();
}

main().catch(console.error);
