import { initDatabase, closeDatabase } from './index.js';

// Standalone migration runner
const db = initDatabase();
console.log('Migrations applied successfully');
closeDatabase();
