import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { createAdminPool } from '../src/db';
import { runMigrationCommand } from '../src/db/migrate';

const EMPTY_TEST_DB = 'amal_mig_empty_test';

describe('Drizzle Migration Baseline, Empty-DB Provisioning & Hardened RLS', () => {
  it('migrates cleanly from a brand-new empty PostgreSQL DB, runs idempotently on existing schema, and enforces amal_app RLS + role restrictions', async () => {
    const maintenancePool = createAdminPool({ database: 'postgres' });
    let tempPool: pg.Pool | null = null;
    let appTempPool: pg.Pool | null = null;

    try {
      await maintenancePool.query(`DROP DATABASE IF EXISTS ${EMPTY_TEST_DB}`);
      await maintenancePool.query(`CREATE DATABASE ${EMPTY_TEST_DB} OWNER amal_admin`);

      // 1. Fresh migration from completely empty DB
      const firstRun = await runMigrationCommand('migrate', EMPTY_TEST_DB);
      expect(firstRun.appliedCount).toBe(1);
      expect(firstRun.localCount).toBe(1);
      expect(firstRun.totalTables).toBe(38);
      expect(firstRun.forceRlsTables).toBe(33);

      // 2. Re-running migrate on an existing schema must be an idempotent no-op
      const secondRun = await runMigrationCommand('migrate', EMPTY_TEST_DB);
      expect(secondRun.appliedCount).toBe(1);
      expect(secondRun.totalTables).toBe(38);
      expect(secondRun.forceRlsTables).toBe(33);

      // 3. Verify SECURITY DEFINER search_path hardening & amal_app role flags
      tempPool = createAdminPool({ database: EMPTY_TEST_DB });
      const definerRes = await tempPool.query<{ proname: string; proconfig: string[] | null }>(
        `SELECT p.proname, p.proconfig
         FROM pg_proc p
         JOIN pg_namespace n ON n.oid = p.pronamespace
         WHERE n.nspname = 'public' AND p.prosecdef = true
         ORDER BY p.proname`
      );
      expect(definerRes.rows.length).toBe(6);
      for (const fn of definerRes.rows) {
        expect(fn.proconfig).toContain('search_path=pg_catalog, public');
      }

      // 4. Connect as runtime role `amal_app` with max:1 pool to verify RLS + privilege restrictions + pool reset
      appTempPool = new pg.Pool({
        host: process.env.SQL_HOST || '127.0.0.1',
        port: Number(process.env.SQL_PORT || 5432),
        user: process.env.SQL_USER || 'amal_app',
        password: process.env.SQL_PASSWORD || 'amal_dev_app_secret',
        database: EMPTY_TEST_DB,
        max: 1,
      });
      // Touch drizzle wrapper to confirm compatibility
      void drizzle(appTempPool);

      const client = await appTempPool.connect();
      try {
        // Without tenant context: cannot insert into tenants
        await expect(
          client.query(
            `INSERT INTO tenants (id, slug, business_name, tagline, primary_business_type, business_types, enabled_capabilities, allowed_workflows)
             VALUES (gen_random_uuid(), 'no-ctx', 'No Context', 'Tag', 'restaurant', ARRAY['restaurant']::text[], ARRAY['qr_menu']::text[], ARRAY['dine_in_qr']::text[])`
          )
        ).rejects.toThrow(/row-level security/i);

        // Role hardening: amal_app cannot insert into canonical roles table
        await expect(
          client.query(
            `INSERT INTO roles (id, name, scope_level, permissions)
             VALUES ('hacked_role', 'Hacked', 'tenant', ARRAY['*']::text[])`
          )
        ).rejects.toThrow(/permission denied/i);

        // Tenant A transaction creates a tenant & audit log
        const tenantA = '11111111-1111-4111-8111-111111111111';
        const tenantB = '22222222-2222-4222-8222-222222222222';

        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [tenantA]);
        await client.query(
          `INSERT INTO tenants (id, slug, business_name, tagline, primary_business_type, business_types, enabled_capabilities, allowed_workflows)
           VALUES ($1, 'tenant-a-mig', 'Tenant A', 'Tag A', 'coffee_house', ARRAY['coffee_house']::text[], ARRAY['qr_menu']::text[], ARRAY['counter_pickup']::text[])`,
          [tenantA]
        );
        await client.query(
          `INSERT INTO audit_logs (tenant_id, action, resource_type)
           VALUES ($1, 'mig.test', 'tenant')`,
          [tenantA]
        );
        // Append-only hardening: amal_app cannot DELETE its own audit_logs even inside tenant A
        await expect(client.query(`DELETE FROM audit_logs WHERE tenant_id = $1`, [tenantA])).rejects.toThrow(
          /permission denied/i
        );
        await client.query('ROLLBACK');

        // Re-insert Tenant A cleanly & verify Tenant B cannot see or mutate Tenant A
        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [tenantA]);
        await client.query(
          `INSERT INTO tenants (id, slug, business_name, tagline, primary_business_type, business_types, enabled_capabilities, allowed_workflows)
           VALUES ($1, 'tenant-a-mig', 'Tenant A', 'Tag A', 'coffee_house', ARRAY['coffee_house']::text[], ARRAY['qr_menu']::text[], ARRAY['counter_pickup']::text[])`,
          [tenantA]
        );
        await client.query('COMMIT');

        // Next request on the SAME max:1 pooled connection has zero leftover context
        const unconfigured = await client.query(`SELECT id FROM tenants`);
        expect(unconfigured.rows.length).toBe(0);

        await client.query('BEGIN');
        await client.query(`SELECT set_config('app.current_tenant_id', $1, true)`, [tenantB]);
        const bReadsA = await client.query(`SELECT id FROM tenants WHERE id = $1`, [tenantA]);
        expect(bReadsA.rows.length).toBe(0);
        await expect(
          client.query(
            `INSERT INTO branches (tenant_id, name, city, neighborhood, phone, whatsapp_number)
             VALUES ($1, 'Hijack', 'Jimma', 'Center', '+251911000000', '+251911000000')`,
            [tenantA]
          )
        ).rejects.toThrow(/row-level security/i);
        await client.query('COMMIT');
      } finally {
        client.release();
      }
    } finally {
      if (appTempPool) await appTempPool.end();
      if (tempPool) await tempPool.end();
      await maintenancePool.query(`DROP DATABASE IF EXISTS ${EMPTY_TEST_DB}`);
      await maintenancePool.end();
    }
  });
});
