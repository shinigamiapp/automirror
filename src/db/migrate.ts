import { initDatabase, closeDatabase } from './index.js';

// Standalone migration runner
async function main() {
  await initDatabase();
  console.log('Migrations applied successfully');
  await closeDatabase();
}

main().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
