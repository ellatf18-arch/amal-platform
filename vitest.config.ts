import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    testTimeout: 20_000,
    hookTimeout: 20_000,
    env: {
      NODE_ENV: 'test',
      SQL_HOST: '127.0.0.1',
      SQL_PORT: '5432',
      SQL_USER: 'amal_app',
      SQL_PASSWORD: 'amal_dev_app_secret',
      SQL_DB_NAME: 'amal_test',
      SQL_ADMIN_USER: 'amal_admin',
      SQL_ADMIN_PASSWORD: 'amal_dev_admin_secret',
      PAYMENT_MODE: 'disabled',
      SANDBOX_WEBHOOK_HMAC_SECRET: 'amal_test_sandbox_secret',
      INTERNAL_WORKER_SECRET: 'amal_dev_worker_secret',
    },
  },
});
