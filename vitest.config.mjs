import { defineConfig } from 'vitest/config'
import path from 'path'
import { randomBytes } from 'crypto'
import os from 'os'

// Integration tests run against a throwaway database created on the local
// Postgres named by TEST_DATABASE_ADMIN_URL (never a production database).
const adminUrl = process.env.TEST_DATABASE_ADMIN_URL || 'postgresql://postgres@127.0.0.1:54329/postgres'
const dbName = process.env.TEST_DB_NAME || `dockly_it_${randomBytes(4).toString('hex')}`
const dbUrl = adminUrl.replace(/\/[^/?]+(\?|$)/, `/${dbName}$1`)
process.env.TEST_DB_NAME = dbName

export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, './src'), '@shared': path.resolve(__dirname, './shared') } },
  test: {
    include: ['server/tests/**/*.test.mjs', 'src/**/*.test.ts'],
    globalSetup: ['server/tests/globalSetup.mjs'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      TEST_DATABASE_ADMIN_URL: adminUrl,
      DATABASE_URL: dbUrl,
      DATABASE_SSL: 'false',
      SESSION_SECRET: 'test-session-secret-0123456789-0123456789',
      STORAGE_DRIVER: 'local',
      LOCAL_STORAGE_DIR: path.join(os.tmpdir(), `dockly-test-storage-${dbName}`),
      WHATSAPP_MODE: 'log',
      WHATSAPP_APP_SECRET: 'test-app-secret',
      WHATSAPP_VERIFY_TOKEN: 'test-verify-token',
      AUTOMATION_ENABLED: 'false',
      APP_BASE_URL: 'http://localhost',
      AWS_ACCESS_KEY_ID: '',
      AWS_SECRET_ACCESS_KEY: '',
      RESEND_API_KEY: '',
    },
  },
})
