import Database from 'better-sqlite3';
import { migrate } from '../../src/storage/migrations';
import { AuditRepository } from '../../src/storage/audit.repo';

describe('AuditRepository', () => {
    let db: Database.Database;
    let repo: AuditRepository;

    beforeEach(() => {
        db = new Database(':memory:');
        migrate(db);
        repo = new AuditRepository(db);
    });

    it('should create and list audit logs', () => {
        const log = {
            action: 'test_action',
            actorId: 'user-1',
            targetId: 'target-1',
            details: { foo: 'bar' },
            timestamp: new Date().toISOString()
        };

        const created = repo.create(log);
        expect(created.id).toBeDefined();
        expect(created.action).toBe(log.action);
        expect(created.details).toEqual(log.details);

        const list = repo.list();
        expect(list).toHaveLength(1);
        expect(list[0]).toEqual(created);
    });

    it('should handle missing optional fields', () => {
        const log = {
            action: 'simple_action',
            timestamp: new Date().toISOString()
        };

        const created = repo.create(log);
        expect(created.id).toBeDefined();
        expect(created.actorId).toBeNull();
        expect(created.details).toBeUndefined();
    });
});

describe('AuditRepository retention', () => {
    it('keeps only the newest rows', () => {
        const db = new Database(':memory:');
        migrate(db);
        const repo = new AuditRepository(db, { maxRows: 150 });

        for (let i = 1; i <= 400; i++) {
            repo.create({ action: `call-${i}`, actorId: null, targetId: null, timestamp: new Date().toISOString() });
        }

        const count = (db.prepare('SELECT COUNT(*) AS n FROM audit_logs').get() as { n: number }).n;
        expect(count).toBe(150);
        const oldest = db.prepare('SELECT action FROM audit_logs ORDER BY id ASC LIMIT 1').get() as { action: string };
        expect(oldest.action).toBe('call-251');
    });

    it('prune() removes nothing when under the limit', () => {
        const db = new Database(':memory:');
        migrate(db);
        const repo = new AuditRepository(db, { maxRows: 150 });
        repo.create({ action: 'only', actorId: null, targetId: null, timestamp: new Date().toISOString() });
        expect(repo.prune()).toBe(0);
        expect(repo.list()).toHaveLength(1);
    });
});
