import { buildApp } from './app.js';
import { CONFIG } from './config.js';
import { initDatabase, closeDatabase, recoverStaleTasks } from './db/index.js';
import { WorkerScheduler } from './workers/scheduler.js';
import { scannerTick } from './workers/scanner.js';
import { syncProcessorTick } from './workers/sync-processor.js';

async function main() {
  const app = await buildApp();

  // Initialize database and run migrations
  const db = initDatabase();
  app.log.info({ path: CONFIG.DATABASE_PATH }, 'Database initialized');

  // Recover any stale tasks from previous crash
  recoverStaleTasks(db);
  app.log.info('Stale task recovery complete');

  // Start workers
  const scanner = new WorkerScheduler(
    'scanner',
    () => scannerTick(app.log),
    CONFIG.SCANNER_INTERVAL_MS,
    app.log,
  );

  const syncProcessor = new WorkerScheduler(
    'sync-processor',
    () => syncProcessorTick(app.log),
    CONFIG.PROCESSOR_INTERVAL_MS,
    app.log,
  );

  scanner.start();
  syncProcessor.start();

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'Shutting down...');

    await scanner.stop();
    await syncProcessor.stop();

    await app.close();
    closeDatabase();

    app.log.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  // Start server
  await app.listen({ port: CONFIG.PORT, host: CONFIG.HOST });
  app.log.info(`Scalar API docs at http://localhost:${CONFIG.PORT}/reference`);
}

main().catch((err) => {
  console.error('Fatal error during startup:', err);
  process.exit(1);
});
