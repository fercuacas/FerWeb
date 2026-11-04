import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  // The smoke suite targets one running development stack.
  workers: 1,
  fullyParallel: false,
  use: {
    baseURL: process.env.FERWEB_URL ?? 'http://127.0.0.1:5173',
    headless: true,
    trace: 'retain-on-failure',
  },
  reporter: 'list',
});
