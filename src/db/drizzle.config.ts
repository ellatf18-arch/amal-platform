import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

const sslEnabled = process.env.SQL_SSL === 'true';

export default defineConfig({
  schema: './src/db/schema.ts',
  out: './drizzle',
  dialect: 'postgresql',
  dbCredentials: {
    host: process.env.SQL_HOST || '127.0.0.1',
    port: Number(process.env.SQL_PORT || 5432),
    user: process.env.SQL_ADMIN_USER || 'amal_admin',
    password: process.env.SQL_ADMIN_PASSWORD || 'amal_dev_admin_secret',
    database: process.env.SQL_DB_NAME || 'amal_dev',
    ssl: sslEnabled
      ? { rejectUnauthorized: process.env.SQL_SSL_REJECT_UNAUTHORIZED !== 'false' }
      : false,
  },
});
