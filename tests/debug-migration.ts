import Database from 'better-sqlite3';
import { migrate } from '../src/storage/migrations.js';

try {
    console.log('Starting migration debug...');
    const db = new Database(':memory:');
    migrate(db);
    console.log('Migration successful!');
} catch (error) {
    console.error('Migration failed:', error);
}
