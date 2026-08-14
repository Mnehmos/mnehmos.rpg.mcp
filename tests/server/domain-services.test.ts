import { getDb } from '../../src/storage/index.js';
import {
    createDomainServices,
    getDomainServices,
    runWithDomainServices,
    type DomainServices,
} from '../../src/server/domain-services.js';
import { useInMemoryDatabase } from '../helpers/test-db.js';

useInMemoryDatabase();

describe('domain service boundary', () => {
    it('allows handlers and tests to inject a request-scoped facade', async () => {
        const services = createDomainServices(getDb());

        await runWithDomainServices(services, async () => {
            expect(getDomainServices()).toBe(services);
        });

        expect(getDomainServices()).not.toBe(services);
    });

    it('exposes the repository dependencies needed by combat, world, and inventory', () => {
        const services = getDomainServices();
        const required: Array<keyof DomainServices> = [
            'db', 'character', 'combatActionLog', 'concentration', 'encounter',
            'eventInbox', 'inventory', 'item', 'world', 'worldSnapshot'
        ];

        for (const key of required) expect(services[key]).toBeDefined();
    });
});
