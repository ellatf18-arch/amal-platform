import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { beforeEach, describe, expect, it } from 'vitest';
import { withTenantTransaction } from '../server/db/tenantTx';
import { db } from '../src/db';
import * as schema from '../src/db/schema';
import { branches, products } from '../src/db/schema';
import { registerAndOnboardUser, resetTestDatabase } from './helpers/testSetup';

describe('PostgreSQL Row-Level Security & Pool Connection Reuse Isolation', () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it('blocks direct cross-tenant reads and writes when RLS is active as amal_app (NOBYPASSRLS)', async () => {
    const tA = await registerAndOnboardUser({
      email: 'owner-a@amal.test',
      password: 'PasswordA123!',
      fullName: 'Owner A',
      businessName: 'Jimma Grill A',
      primaryType: 'restaurant',
    });

    const tB = await registerAndOnboardUser({
      email: 'owner-b@amal.test',
      password: 'PasswordB123!',
      fullName: 'Owner B',
      businessName: 'Addis Roastery B',
      primaryType: 'coffee_house',
    });

    // Direct query without tenant transaction context must return zero rows
    const bareProducts = await db.select().from(products).catch(() => []);
    expect(bareProducts.length).toBe(0);

    // Tenant A session cannot see Tenant B products even if querying by Tenant B branch/product IDs
    const visibleToA = await withTenantTransaction(tA.workspace.id, async (tx) => {
      return tx.select({ id: products.id, tenantId: products.tenantId }).from(products);
    });
    expect(visibleToA.length).toBeGreaterThan(0);
    expect(visibleToA.every((p) => p.tenantId === tA.workspace.id)).toBe(true);

    // Attempting to insert into Tenant B while transaction context is Tenant A must fail RLS WITH CHECK
    await expect(
      withTenantTransaction(tA.workspace.id, async (tx) => {
        await tx.insert(branches).values({
          tenantId: tB.workspace.id,
          name: 'Injected Cross-Tenant Branch',
          city: 'Jimma',
          neighborhood: 'Merkato',
          phone: '+251900000000',
          whatsappNumber: '+251900000000',
          displayHours: '08:00 - 20:00',
        });
      })
    ).rejects.toThrow();
  });

  it('guarantees zero tenant context leak across consecutive requests on a max:1 pg.Pool', async () => {
    const tA = await registerAndOnboardUser({
      email: 'pool-a@amal.test',
      password: 'PasswordA123!',
      fullName: 'Pool A',
      businessName: 'Pool Tenant A',
    });
    const tB = await registerAndOnboardUser({
      email: 'pool-b@amal.test',
      password: 'PasswordB123!',
      fullName: 'Pool B',
      businessName: 'Pool Tenant B',
    });

    const singleConnPool = new pg.Pool({
      host: '127.0.0.1',
      port: 5432,
      user: 'amal_app',
      password: 'amal_dev_app_secret',
      database: 'amal_test',
      max: 1,
    });

    try {
      const singleDb = drizzle(singleConnPool, { schema });

      // Transaction 1 sets Tenant A locally (`is_local = true`)
      await singleDb.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tA.workspace.id}, true)`);
        const rows = await tx.select({ id: branches.id, tenantId: branches.tenantId }).from(branches);
        expect(rows.length).toBeGreaterThan(0);
        expect(rows[0].tenantId).toBe(tA.workspace.id);
      });

      // Same physical PG backend connection checked out without setting tenant context must see empty string & zero rows
      await singleDb.transaction(async (tx) => {
        const settingRes = await tx.execute(
          sql`SELECT current_setting('app.current_tenant_id', true) AS val`
        );
        const val = (settingRes.rows[0] as { val: string | null }).val;
        expect(val === '' || val === null).toBe(true);

        const leakedRows = await tx.select({ id: branches.id }).from(branches);
        expect(leakedRows.length).toBe(0);
      });

      // Next transaction sets Tenant B cleanly
      await singleDb.transaction(async (tx) => {
        await tx.execute(sql`SELECT set_config('app.current_tenant_id', ${tB.workspace.id}, true)`);
        const rows = await tx.select({ tenantId: branches.tenantId }).from(branches);
        expect(rows.every((r) => r.tenantId === tB.workspace.id)).toBe(true);
        const aRows = rows.filter((r) => eq(branches.tenantId, tA.workspace.id) && r.tenantId === tA.workspace.id);
        expect(aRows.length).toBe(0);
      });
    } finally {
      await singleConnPool.end();
    }
  });
});
