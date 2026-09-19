import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir: './tests', workers: 1, timeout: 30000,
  use: { baseURL: 'http://127.0.0.1:5186', viewport: { width: 1440, height: 1050 }, channel: 'chrome', launchOptions: { args: ['--enable-unsafe-webgpu'] } },
  webServer: { command: 'npm run dev -- --port 5186 --strictPort', url: 'http://127.0.0.1:5186', reuseExistingServer: !process.env.CI },
});
