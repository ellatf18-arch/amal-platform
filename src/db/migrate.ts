import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate as drizzleMigrate } from 'drizzle-orm/node-postgres/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import pg from 'pg';
import { createAdminPool } from './index';
import * as schema from './schema';

const MIGRATIONS_FOLDER = path.resolve(process.cwd(), 'drizzle');
const RLS_SQL_PATH = path.resolve(process.cwd(), 'src/db/rls.sql');
const BASELINE_SNAPSHOT_PATH = path.resolve(MIGRATIONS_FOLDER, 'meta/0000_snapshot.json');

type CommandMode = 'migrate' | 'baseline' | 'status' | 'rls-only';

async function applyRlsSql(client: pg.PoolClient): Promise<void> {
  const rlsSql = fs.readFileSync(RLS_SQL_PATH, 'utf8');
  await client.query('BEGIN');
  try {
    await client.query(rlsSql);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  }
}

async function getDbSnapshotInfo(pool: pg.Pool) {
  const tablesRes = await pool.query<{
    relname: string;
    relrowsecurity: boolean;
    relforcerowsecurity: boolean;
  }>(
    `SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relkind = 'r'
     ORDER BY c.relname`
  );

  const rolesRes = await pool.query<{
    rolname: string;
    rolsuper: boolean;
    rolbypassrls: boolean;
    rolcanlogin: boolean;
  }>(
    `SELECT rolname, rolsuper, rolbypassrls, rolcanlogin
     FROM pg_roles
     WHERE rolname IN ('amal_app', 'amal_admin')
     ORDER BY rolname`
  );

  let appliedMigrations: Array<{ id: number; hash: string; created_at: string }> = [];
  const hasMigTableRes = await pool.query<{ exists: boolean }>(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'drizzle' AND table_name = '__drizzle_migrations'
     ) AS exists`
  );

  if (hasMigTableRes.rows[0]?.exists) {
    const migRows = await pool.query<{ id: number; hash: string; created_at: string }>(
      `SELECT id, hash, created_at::text FROM drizzle.__drizzle_migrations ORDER BY created_at ASC`
    );
    appliedMigrations = migRows.rows;
  }

  return {
    tables: tablesRes.rows,
    roles: rolesRes.rows,
    appliedMigrations,
  };
}

export async function runMigrationCommand(
  mode: CommandMode,
  databaseOverride?: string
): Promise<{
  mode: CommandMode;
  database: string;
  appliedCount: number;
  localCount: number;
  totalTables: number;
  forceRlsTables: number;
}> {
  const targetDb = databaseOverride || process.env.SQL_DB_NAME || 'amal_dev';
  const adminPool = createAdminPool({ database: targetDb });
  const adminDb = drizzle(adminPool, { schema });

  try {
    const localMigrations = readMigrationFiles({ migrationsFolder: MIGRATIONS_FOLDER });

    if (mode === 'status') {
      const info = await getDbSnapshotInfo(adminPool);
      const lastApplied =
        info.appliedMigrations[info.appliedMigrations.length - 1]?.created_at || null;
      const pending = localMigrations.filter(
        (m) => !lastApplied || Number(lastApplied) < m.folderMillis
      );
      const forceRlsTables = info.tables.filter(
        (t) => t.relrowsecurity && t.relforcerowsecurity
      ).length;

      console.log(
        JSON.stringify(
          {
            database: targetDb,
            localMigrationCount: localMigrations.length,
            appliedMigrationCount: info.appliedMigrations.length,
            pendingMigrationCount: pending.length,
            totalTables: info.tables.length,
            forceRlsTables,
            roles: info.roles,
          },
          null,
          2
        )
      );

      return {
        mode,
        database: targetDb,
        appliedCount: info.appliedMigrations.length,
        localCount: localMigrations.length,
        totalTables: info.tables.length,
        forceRlsTables,
      };
    }

    if (mode === 'baseline') {
      const info = await getDbSnapshotInfo(adminPool);
      if (info.appliedMigrations.length > 0) {
        throw new Error(
          `Database "${targetDb}" already has ${info.appliedMigrations.length} recorded migration(s). Refusing to overwrite migration history.`
        );
      }

      const snapshot = JSON.parse(fs.readFileSync(BASELINE_SNAPSHOT_PATH, 'utf8')) as {
        tables: Record<string, { name: string }>;
      };
      const expectedTableNames = Object.keys(snapshot.tables).map((k) => k.replace(/^public\./, ''));
      const existingNames = new Set(info.tables.map((t) => t.relname));
      const missing = expectedTableNames.filter((name) => !existingNames.has(name));

      if (missing.length > 0) {
        throw new Error(
          `Cannot baseline "${targetDb}": missing expected tables (${missing.join(', ')}). Run "db:migrate" on an empty/incomplete DB instead.`
        );
      }

      const baselineMigration = localMigrations[0];
      if (!baselineMigration) {
        throw new Error('No initial migration found in ./drizzle');
      }

      const client = await adminPool.connect();
      try {
        await client.query('BEGIN');
        await client.query('CREATE SCHEMA IF NOT EXISTS drizzle');
        await client.query(`
          CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (
            id SERIAL PRIMARY KEY,
            hash text NOT NULL,
            created_at bigint
          )
        `);
        await client.query(
          `INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ($1, $2)`,
          [baselineMigration.hash, baselineMigration.folderMillis]
        );
        await client.query('COMMIT');
        await applyRlsSql(client);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }

      const after = await getDbSnapshotInfo(adminPool);
      const forceRlsTables = after.tables.filter(
        (t) => t.relrowsecurity && t.relforcerowsecurity
      ).length;
      console.log(
        `Baselined "${targetDb}" at 0000_initial_baseline and synchronized RLS (${forceRlsTables}/${after.tables.length} tables with FORCE RLS).`
      );
      return {
        mode,
        database: targetDb,
        appliedCount: after.appliedMigrations.length,
        localCount: localMigrations.length,
        totalTables: after.tables.length,
        forceRlsTables,
      };
    }

    if (mode === 'rls-only') {
      const client = await adminPool.connect();
      try {
        await applyRlsSql(client);
      } finally {
        client.release();
      }
      const after = await getDbSnapshotInfo(adminPool);
      const forceRlsTables = after.tables.filter(
        (t) => t.relrowsecurity && t.relforcerowsecurity
      ).length;
      console.log(
        `Synchronized RLS on "${targetDb}" (${forceRlsTables}/${after.tables.length} tables with FORCE RLS).`
      );
      return {
        mode,
        database: targetDb,
        appliedCount: after.appliedMigrations.length,
        localCount: localMigrations.length,
        totalTables: after.tables.length,
        forceRlsTables,
      };
    }

    // Default: 'migrate' — execute pending Drizzle SQL migrations, then synchronize RLS
    await drizzleMigrate(adminDb, { migrationsFolder: MIGRATIONS_FOLDER });
    const client = await adminPool.connect();
    try {
      await applyRlsSql(client);
    } finally {
      client.release();
    }

    const after = await getDbSnapshotInfo(adminPool);
    const forceRlsTables = after.tables.filter(
      (t) => t.relrowsecurity && t.relforcerowsecurity
    ).length;
    console.log(
      `Migrated "${targetDb}" (${after.appliedMigrations.length}/${localMigrations.length} recorded) & synchronized RLS (${forceRlsTables}/${after.tables.length} tables with FORCE RLS).`
    );
    return {
      mode,
      database: targetDb,
      appliedCount: after.appliedMigrations.length,
      localCount: localMigrations.length,
      totalTables: after.tables.length,
      forceRlsTables,
    };
  } finally {
    await adminPool.end();
  }
}

const isCli =
  typeof process.argv[1] === 'string' &&
  path.resolve(process.argv[1]).endsWith(`${path.sep}migrate.ts`);

if (isCli && !process.env.VITEST) {
  const arg = (process.argv[2] as CommandMode | undefined) || 'migrate';
  const allowed: CommandMode[] = ['migrate', 'baseline', 'status', 'rls-only'];
  if (!allowed.includes(arg)) {
    console.error(`Unknown mode "${arg}". Expected one of: ${allowed.join(', ')}`);
    process.exit(1);
  }
  runMigrationCommand(arg).catch((err) => {
    console.error('Migration command failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
