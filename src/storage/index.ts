import Database from 'better-sqlite3';
import { initDB } from './db.js';
import { migrate } from './migrations.js';

let dbInstance: Database.Database | null = null;

export function getDb(path: string = 'rpg.db'): Database.Database {
    if (!dbInstance) {
        dbInstance = initDB(path);
        migrate(dbInstance);
    }
    return dbInstance;
}

export function setDb(database: Database.Database) {
    dbInstance = database;
}

export function closeDb() {
    if (dbInstance) {
        dbInstance.close();
        dbInstance = null;
    }
}

export * from './db.js';
export * from './migrations.js';
export * from './audit.repo.js';
