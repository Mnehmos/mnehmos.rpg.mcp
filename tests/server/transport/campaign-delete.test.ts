import { createHmac } from 'node:crypto';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { startHttpServerTransport } from '../../../src/server/transport/http';
import { campaignDbPath, closeDb, getDb, listCampaignDatabases } from '../../../src/storage/index';
import { runInTenant } from '../../../src/storage/tenant-context';

const AUTH = 'service-token';
const SECRET = 'tenant-secret';
const CAMPAIGN = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';

function tenantHeader(campaignId: string, secret = SECRET): string {
    const now = Math.floor(Date.now() / 1000);
    const payload = { accountId: 'account-1', campaignId, iat: now, exp: now + 120 };
    const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
    const signature = createHmac('sha256', secret).update(encoded).digest('base64url');
    return `${encoded}.${signature}`;
}

describe('DELETE /campaign', () => {
    let server: Server;
    let url: string;
    let dataDir: string;
    let previousDataDir: string | undefined;

    beforeEach(async () => {
        closeDb();
        previousDataDir = process.env.RPG_DATA_DIR;
        dataDir = mkdtempSync(join(tmpdir(), 'rpg-delete-'));
        process.env.RPG_DATA_DIR = dataDir;

        server = await startHttpServerTransport(
            () => new McpServer({ name: 'test', version: '0.0.0' }),
            0,
            { host: '127.0.0.1', authToken: AUTH, tenantSecret: SECRET }
        );
        url = `http://127.0.0.1:${(server.address() as AddressInfo).port}/campaign`;
    });

    afterEach(async () => {
        await new Promise<void>(resolve => server.close(() => resolve()));
        closeDb();
        if (previousDataDir === undefined) delete process.env.RPG_DATA_DIR;
        else process.env.RPG_DATA_DIR = previousDataDir;
        rmSync(dataDir, { recursive: true, force: true });
    });

    const del = (headers: Record<string, string>) => fetch(url, { method: 'DELETE', headers });

    it('erases the campaign named by the signed context', async () => {
        runInTenant({ accountId: 'account-1', campaignId: CAMPAIGN }, () => getDb());
        closeDb();
        expect(existsSync(campaignDbPath(CAMPAIGN))).toBe(true);

        const response = await del({
            authorization: `Bearer ${AUTH}`,
            'x-rpg-tenant': tenantHeader(CAMPAIGN),
        });

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ deleted: true });
        expect(existsSync(campaignDbPath(CAMPAIGN))).toBe(false);
    });

    it('erases only the campaign in the context, not its neighbours', async () => {
        runInTenant({ accountId: 'account-1', campaignId: CAMPAIGN }, () => getDb());
        runInTenant({ accountId: 'account-1', campaignId: OTHER }, () => getDb());
        closeDb();

        await del({ authorization: `Bearer ${AUTH}`, 'x-rpg-tenant': tenantHeader(CAMPAIGN) });

        expect(listCampaignDatabases()).toEqual([OTHER]);
    });

    it('reports deleted:false for a campaign with no database', async () => {
        const response = await del({
            authorization: `Bearer ${AUTH}`,
            'x-rpg-tenant': tenantHeader(CAMPAIGN),
        });

        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ deleted: false });
    });

    it('refuses a request with no tenant context rather than guessing', async () => {
        const response = await del({ authorization: `Bearer ${AUTH}` });

        expect(response.status).toBe(401);
    });

    it('refuses a tenant context signed with the wrong secret', async () => {
        runInTenant({ accountId: 'account-1', campaignId: CAMPAIGN }, () => getDb());
        closeDb();

        const response = await del({
            authorization: `Bearer ${AUTH}`,
            'x-rpg-tenant': tenantHeader(CAMPAIGN, 'staging-secret'),
        });

        expect(response.status).toBe(401);
        // The forged request must not have erased anything.
        expect(existsSync(campaignDbPath(CAMPAIGN))).toBe(true);
    });

    it('refuses a request without the service token', async () => {
        const response = await del({ 'x-rpg-tenant': tenantHeader(CAMPAIGN) });

        expect(response.status).toBe(401);
    });

    it('rejects methods other than DELETE', async () => {
        const response = await fetch(url, {
            method: 'GET',
            headers: { authorization: `Bearer ${AUTH}`, 'x-rpg-tenant': tenantHeader(CAMPAIGN) },
        });

        expect(response.status).toBe(405);
    });
});
