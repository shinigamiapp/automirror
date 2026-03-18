import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: '127.0.0.1',
  port: 3306,
  user: 'automirror',
  password: 'v1gsFRAISWKkLR/LwMyL+u9T9odbA7gN',
  database: 'automirror',
  dateStrings: true,
});

type Brand = 'komikcast' | 'kiryuu' | 'ikiru' | 'westmanga' | 'cosmicscans' | 'apkomik' | 'mgkomik' | 'unknown';

function detectBrand(url: string): Brand {
  const domain = url.toLowerCase();
  if (/komikcast/.test(domain)) return 'komikcast';
  if (/kiryuu/.test(domain)) return 'kiryuu';
  if (/ikiru/.test(domain)) return 'ikiru';
  if (/westmanga/.test(domain)) return 'westmanga';
  if (/cosmicscans/.test(domain)) return 'cosmicscans';
  if (/apkomik/.test(domain)) return 'apkomik';
  if (/mgkomik/.test(domain)) return 'mgkomik';
  return 'unknown';
}

/**
 * Extract chapter number from URL using connector-specific patterns
 */
function getChapterNumberFromUrl(url: string): number {
  const brand = detectBrand(url);

  switch (brand) {
    case 'komikcast': {
      const m = url.match(/\/chapter\/(\d+(?:\.\d+)?)/);
      return m ? parseFloat(m[1]) : 0;
    }
    case 'kiryuu':
    case 'ikiru': {
      const m = url.match(/\/chapter-(\d+(?:\.\d+)?)\.\d{5,}/);
      return m ? parseFloat(m[1]) : 0;
    }
    case 'westmanga': {
      const dec = url.match(/-chapter-(\d+)-(\d+)-/);
      if (dec) return parseFloat(`${dec[1]}.${dec[2]}`);
      const int = url.match(/-chapter-(\d+)-[^0-9]/);
      return int ? parseFloat(int[1]) : 0;
    }
    case 'cosmicscans': {
      const dec = url.match(/-chapter-(\d+)-(\d+)\//);
      if (dec) return parseFloat(`${dec[1]}.${dec[2]}`);
      const int = url.match(/-chapter-(\d+)\//);
      return int ? parseFloat(int[1]) : 0;
    }
    case 'apkomik': {
      const dec = url.match(/-chapter-(\d+)-(\d+)-bahasa/);
      if (dec) return parseFloat(`${dec[1]}.${dec[2]}`);
      const int = url.match(/-chapter-(\d+)-bahasa/);
      return int ? parseFloat(int[1]) : 0;
    }
    case 'mgkomik': {
      const m = url.match(/\/chapter-(\d+)\/?$/);
      if (!m) return 0;
      const token = m[1];
      if (token.startsWith('0') && token.length >= 2) {
        const rest = token.slice(1);
        return rest.length === 1 ? parseFloat(rest) : parseFloat(`${rest[0]}.${rest.slice(1)}`);
      }
      return parseFloat(token);
    }
    default: {
      // Generic fallback patterns
      const patterns = [
        /\/chapter\/(\d+(?:\.\d+)?)/,
        /\/chapter-(\d+(?:\.\d+)?)\.\d{5,}/,
        /\/chapter-(\d+(?:\.\d+)?)/,
        /-chapter-(\d+)-(\d+)/,
        /-chapter-(\d+)/,
      ];
      for (const p of patterns) {
        const m = url.match(p);
        if (m) {
          if (m[2]) return parseFloat(`${m[1]}.${m[2]}`);
          return parseFloat(m[1]);
        }
      }
      return 0;
    }
  }
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  
  console.log(dryRun ? '=== DRY RUN MODE ===' : '=== EXECUTING FIXES ===');
  console.log('');

  // Get all tasks with chapter_number = 0
  const [tasks] = await pool.execute(`
    SELECT mst.id, mst.chapter_url, mst.chapter_number, mst.status,
           mr.series_title, mr.manga_id, mr.id as registry_id
    FROM manga_sync_tasks mst
    JOIN manga_registry mr ON mst.manga_registry_id = mr.id
    WHERE mst.chapter_number = 0
    ORDER BY mr.series_title
  `);

  const zeroTasks = tasks as any[];
  console.log(`Found ${zeroTasks.length} tasks with chapter_number = 0\n`);

  let fixedCount = 0;
  let actualZeroCount = 0;
  let deletedDuplicates = 0;
  const seenUrls = new Map<string, string>(); // url -> first task id

  for (const task of zeroTasks) {
    const correctNumber = getChapterNumberFromUrl(task.chapter_url);
    
    // Check for duplicates (same URL)
    const existingTaskId = seenUrls.get(task.chapter_url);
    if (existingTaskId) {
      console.log(`[DUPLICATE] ${task.series_title} - ${task.chapter_url}`);
      console.log(`  Keeping task: ${existingTaskId}`);
      console.log(`  Deleting task: ${task.id}`);
      
      if (!dryRun) {
        await pool.execute('DELETE FROM manga_sync_tasks WHERE id = ?', [task.id]);
      }
      deletedDuplicates++;
      continue;
    }
    seenUrls.set(task.chapter_url, task.id);

    if (correctNumber > 0) {
      console.log(`[FIX] ${task.series_title}`);
      console.log(`  URL: ${task.chapter_url}`);
      console.log(`  Old: ${task.chapter_number} -> New: ${correctNumber}`);
      console.log(`  Status: ${task.status} -> pending`);
      
      if (!dryRun) {
        await pool.execute(
          `UPDATE manga_sync_tasks 
           SET chapter_number = ?, status = 'pending', error = NULL, updated_at = NOW()
           WHERE id = ?`,
          [correctNumber, task.id]
        );
      }
      fixedCount++;
    } else {
      // Chapter 0 is a prologue - convert to 0.1 since backend rejects chapter_number=0
      console.log(`[PROLOGUE] ${task.series_title}`);
      console.log(`  URL: ${task.chapter_url}`);
      console.log(`  Converting chapter 0 -> 0.1 (prologue)`);
      console.log(`  Status: ${task.status} -> pending`);
      
      if (!dryRun) {
        await pool.execute(
          `UPDATE manga_sync_tasks 
           SET chapter_number = 0.1, status = 'pending', error = NULL, updated_at = NOW()
           WHERE id = ?`,
          [task.id]
        );
      }
      actualZeroCount++;
    }
    console.log('');
  }

  // Reset manga status for affected manga
  if (!dryRun && fixedCount > 0) {
    console.log('Resetting manga status for affected entries...');
    await pool.execute(`
      UPDATE manga_registry mr
      SET status = 'syncing', last_error = NULL, updated_at = NOW()
      WHERE EXISTS (
        SELECT 1 FROM manga_sync_tasks mst
        WHERE mst.manga_registry_id = mr.id
        AND mst.status = 'pending'
      )
      AND mr.status = 'error'
    `);
  }

  console.log('=== SUMMARY ===');
  console.log(`Total tasks with chapter 0: ${zeroTasks.length}`);
  console.log(`Fixed (wrong chapter number): ${fixedCount}`);
  console.log(`Deleted duplicates: ${deletedDuplicates}`);
  console.log(`Prologues (0 -> 0.1): ${actualZeroCount}`);
  
  if (dryRun) {
    console.log('\nRun without --dry-run to apply changes');
  }

  await pool.end();
}

main().catch(console.error);
