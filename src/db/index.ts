import 'dotenv/config';
import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import * as schema from './schema';

const { Pool } = pg;

function resolveSslConfig(): pg.PoolConfig['ssl'] {
  if (process.env.SQL_SSL !== 'true') return false;
  return {
    rejectUnauthorized: process.env.SQL_SSL_REJECT_UNAUTHORIZED !== 'false',
  };
}

function buildPoolConfig(): pg.PoolConfig {
  const host = process.env.SQL_HOST || '127.0.0.1';
  const port = Number(process.env.SQL_PORT || 5432);
  const user = process.env.SQL_USER || 'amal_app';
  const password = process.env.SQL_PASSWORD || 'amal_dev_app_secret';
  const database = process.env.SQL_DB_NAME || 'amal_dev';

  return {
    host,
    port,
    user,
    password,
    database,
    ssl: resolveSslConfig(),
    max: Number(process.env.PG_POOL_MAX || 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  };
}

export const pool = new Pool(buildPoolConfig());
export const db = drizzle(pool, { schema });

export type AppDb = typeof db;

export function createAdminPool(overrides?: Partial<pg.PoolConfig>): pg.Pool {
  return new Pool({
    host: process.env.SQL_HOST || '127.0.0.1',
    port: Number(process.env.SQL_PORT || 5432),
    user: process.env.SQL_ADMIN_USER || 'amal_admin',
    password: process.env.SQL_ADMIN_PASSWORD || 'amal_dev_admin_secret',
    database: process.env.SQL_DB_NAME || 'amal_dev',
    ssl: resolveSslConfig(),
    max: 5,
    ...overrides,
  });
}
