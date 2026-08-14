import { getTenant, requireTenant, runInTenant, type TenantContext } from '../../src/storage/tenant-context';

const tenantA: TenantContext = { accountId: 'account-a', campaignId: 'campaign-a' };
const tenantB: TenantContext = { accountId: 'account-b', campaignId: 'campaign-b' };

const tick = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe('tenant context', () => {
    it('exposes the tenant inside a scope', () => {
        runInTenant(tenantA, () => {
            expect(requireTenant()).toEqual(tenantA);
            expect(getTenant()).toEqual(tenantA);
        });
    });

    it('has no ambient tenant outside a scope', () => {
        expect(getTenant()).toBeUndefined();
    });

    it('fails closed outside a scope rather than defaulting to a shared tenant', () => {
        // The pre-existing withSession wrapper defaulted an absent sessionId to
        // the literal 'default', silently pooling unrelated callers together.
        // Throwing is the whole point: no verified tenant means no database.
        expect(() => requireTenant()).toThrow(/No tenant context in scope/);
    });

    it('restores the outer tenant after a nested scope exits', () => {
        runInTenant(tenantA, () => {
            runInTenant(tenantB, () => {
                expect(requireTenant()).toEqual(tenantB);
            });
            expect(requireTenant()).toEqual(tenantA);
        });
    });

    it('keeps concurrent async flows isolated across await points', async () => {
        // The regression guard for using AsyncLocalStorage instead of a
        // module-level "current tenant" variable. With a plain variable, B's
        // assignment would still be installed when A resumes after its await,
        // and A would read B's tenant — one campaign served another campaign's
        // database. The interleaved ticks force that overlap deterministically.
        const observed: string[] = [];

        const flow = (tenant: TenantContext, label: string) =>
            runInTenant(tenant, async () => {
                observed.push(`${label}:enter:${requireTenant().campaignId}`);
                await tick();
                observed.push(`${label}:resume:${requireTenant().campaignId}`);
                await tick();
                observed.push(`${label}:exit:${requireTenant().campaignId}`);
                return requireTenant().campaignId;
            });

        const [a, b] = await Promise.all([flow(tenantA, 'A'), flow(tenantB, 'B')]);

        expect(a).toBe('campaign-a');
        expect(b).toBe('campaign-b');
        // Every observation must name its own campaign, at every await boundary.
        expect(observed.filter(entry => entry.startsWith('A:'))).toEqual([
            'A:enter:campaign-a',
            'A:resume:campaign-a',
            'A:exit:campaign-a',
        ]);
        expect(observed.filter(entry => entry.startsWith('B:'))).toEqual([
            'B:enter:campaign-b',
            'B:resume:campaign-b',
            'B:exit:campaign-b',
        ]);
    });

    it('does not leak a tenant into work started outside the scope', async () => {
        let leaked: TenantContext | undefined = tenantA;

        const outside = (async () => {
            await tick();
            leaked = getTenant();
        })();

        runInTenant(tenantB, () => {
            expect(requireTenant()).toEqual(tenantB);
        });

        await outside;
        expect(leaked).toBeUndefined();
    });
});
