import mysql from 'mysql2/promise';

const pool = mysql.createPool({
  host: '127.0.0.1',
  port: 3306,
  user: 'automirror',
  password: 'v1gsFRAISWKkLR/LwMyL+u9T9odbA7gN',
  database: 'automirror',
  dateStrings: true,
});

// Current implementation
function parseChapterNumberOld(title: string): number {
  const match = title.match(/(\d+(?:\.\d+)?)/);
  return match ? parseFloat(match[1]) : 0;
}

function getChapterNumberOld(ch: { title: string; url: string; weight?: number }): number {
  const urlMatch = ch.url.match(/\/chapter\/(\d+(?:\.\d+)?)\/?$/);
  if (urlMatch) return parseFloat(urlMatch[1]);
  if (ch.weight !== undefined && ch.weight >= 0) return ch.weight;
  return parseChapterNumberOld(ch.title);
}

// Improved implementation
function getChapterNumberNew(ch: { title: string; url: string; weight?: number }): number {
  // Pattern 1: /chapter/NUMBER/ at end
  let match = ch.url.match(/\/chapter\/(\d+(?:\.\d+)?)\/?$/);
  if (match) return parseFloat(match[1]);
  
  // Pattern 2: /chapter-NUMBER or -chapter-NUMBER in URL (common in slug-based URLs)
  match = ch.url.match(/[/-]chapter[/-]?(\d+(?:\.\d+)?)/i);
  if (match) return parseFloat(match[1]);
  
  // Pattern 3: chapter-NUMBER.EXTRA (like chapter-01.449210)
  match = ch.url.match(/chapter-(\d+(?:\.\d+)?)\.\d+/i);
  if (match) return parseFloat(match[1]);
  
  // Fallback to weight if available
  if (ch.weight !== undefined && ch.weight >= 0) return ch.weight;
  
  // Last resort: parse from title
  const titleMatch = ch.title.match(/(\d+(?:\.\d+)?)/);
  return titleMatch ? parseFloat(titleMatch[1]) : 0;
}

async function main() {
  const [tasks] = await pool.execute(`
    SELECT mst.id, mst.chapter_url, mst.chapter_number, mst.status,
           mr.series_title, mr.manga_id
    FROM manga_sync_tasks mst
    JOIN manga_registry mr ON mst.manga_registry_id = mr.id
    WHERE mst.chapter_number = 0
    ORDER BY mr.series_title
  `);
  
  const zeroTasks = tasks as any[];
  console.log(`Analyzing ${zeroTasks.length} tasks with chapter_number = 0:\n`);
  
  for (const t of zeroTasks) {
    const oldNum = getChapterNumberOld({ title: '', url: t.chapter_url });
    const newNum = getChapterNumberNew({ title: '', url: t.chapter_url });
    
    if (oldNum !== newNum) {
      console.log(`[${t.series_title}]:`);
      console.log(`  URL: ${t.chapter_url}`);
      console.log(`  Old parser: ${oldNum}`);
      console.log(`  New parser: ${newNum}`);
      console.log(`  Status: ${t.status}`);
      console.log('');
    }
  }

  // Count how many would be fixed
  let fixable = 0;
  let stillZero = 0;
  for (const t of zeroTasks) {
    const newNum = getChapterNumberNew({ title: '', url: t.chapter_url });
    if (newNum > 0) {
      fixable++;
    } else {
      stillZero++;
      console.log(`Still zero: ${t.chapter_url}`);
    }
  }
  
  console.log(`\nSummary:`);
  console.log(`  Total chapter 0 tasks: ${zeroTasks.length}`);
  console.log(`  Fixable with new parser: ${fixable}`);
  console.log(`  Still zero (may be actual chapter 0): ${stillZero}`);

  await pool.end();
}

main().catch(console.error);
