export const CONFIG = {
  // Server
  PORT: parseInt(process.env.PORT || '3000', 10),
  HOST: process.env.HOST || '0.0.0.0',
  LOG_LEVEL: process.env.LOG_LEVEL || (process.env.NODE_ENV === 'production' ? 'info' : 'debug'),

  // MySQL Database
  MYSQL_HOST: process.env.MYSQL_HOST || 'localhost',
  MYSQL_PORT: parseInt(process.env.MYSQL_PORT || '3306', 10),
  MYSQL_DATABASE: process.env.MYSQL_DATABASE || 'scraper_worker',
  MYSQL_USER: process.env.MYSQL_USER || 'scraper',
  MYSQL_PASSWORD: process.env.MYSQL_PASSWORD || 'scraper_password',

  // External Services
  SCRAPER_BASE_URL: process.env.SCRAPER_BASE_URL || 'http://localhost:3001',
  UPLOADER_BASE_URL: process.env.UPLOADER_BASE_URL || 'http://localhost:3002',
  BACKEND_API_URL: process.env.BACKEND_API_URL || 'http://localhost:3003',
  CACHE_PURGE_URL: process.env.CACHE_PURGE_URL || 'http://localhost:3004',
  API_URL: process.env.API_URL || 'http://localhost:3004',
  DASHBOARD_URL: process.env.DASHBOARD_URL || 'http://localhost:3000',
  DEFAULT_THUMBNAIL_URL: process.env.DEFAULT_THUMBNAIL_URL || 'https://assets.shngm.id/thumbnail/image/default.jpg',
  // API Keys
  ADMIN_API_KEY: process.env.ADMIN_API_KEY || '',
  UPLOADER_API_KEY: process.env.UPLOADER_API_KEY || '',
  BACKEND_API_KEY: process.env.BACKEND_API_KEY || '',
  CACHE_PURGE_API_KEY: process.env.CACHE_PURGE_API_KEY || '',

  // Notifications
  NOVU_API_KEY: process.env.NOVU_API_KEY || '',
  NOVU_SUBSCRIBER_ID: process.env.NOVU_SUBSCRIBER_ID || '',

  // Scheduler Intervals
  SCANNER_INTERVAL_MS: 60_000,        // Check for due scans every 1 min
  PROCESSOR_INTERVAL_MS: 10_000,      // Process tasks every 10 sec
  BATCH_WORKER_INTERVAL_MS: 10_000,   // Batch pipeline every 10 sec
  CLEANUP_INTERVAL_MS: 3_600_000,     // Cleanup every 1 hour

  // Concurrency
  MAX_CONCURRENT_SCANS: 5,
  MAX_CONCURRENT_SYNCS: 5,
  DEFAULT_CHAPTERS_PER_MANGA: 3,

  // Batch Pipeline (existing)
  MAX_CONCURRENT_SCRAPE: 5,
  MAX_CONCURRENT_UPLOAD: 5,

  // Sync Pipeline (existing)
  MAX_CONCURRENT_SYNC_JOBS: 3,
  MAX_CONCURRENT_SYNC_CHAPTERS: 3,

  // Timeouts
  FETCH_TIMEOUT_MS: 30_000,
  SCRAPE_TIMEOUT_MS: 60_000,
  UPLOAD_TIMEOUT_MS: 120_000,

  // Retry
  MAX_TASK_RETRIES: 3,
  RETRY_DELAY_MS: 5_000,

  // Notifications
  NOTIFY_AFTER_FAILURES: 3,
  NOTIFICATION_COOLDOWN_MS: 3_600_000,

  // Cleanup
  JOB_TTL_DAYS: 7,

  // Circuit Breaker
  CIRCUIT_BREAKER_THRESHOLD: 5,
  CIRCUIT_BREAKER_RESET_MS: 60_000,
} as const;
