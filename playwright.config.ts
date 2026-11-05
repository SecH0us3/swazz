// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { defineConfig, devices } from '@playwright/test';

// SWAZZ_E2E_WEBMCP=0 runs the suite with WebMCP off, so helpers take their DOM fallbacks and the
// real UI paths stay covered too. On by default.
const webMcpEnabled = process.env.SWAZZ_E2E_WEBMCP !== '0';

export default defineConfig({
  testDir: './tests/e2e',
  timeout: 300 * 1000,
  expect: {
    timeout: 8000,
  },
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: process.env.CI ? [['list'], ['blob']] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    // Disable the "Did you know" tips toast in E2E runs. The fixed-position
    // toast (z-index 3000) intercepts pointer events and makes tests flaky
    // (clicks on Project Settings tabs time out).
    storageState: {
      cookies: [],
      origins: [
        {
          origin: 'http://localhost:5173',
          localStorage: [
            { name: 'swazz_tips_enabled', value: 'false' },
            { name: 'swazz_dismissed_tips', value: '[]' },
          ],
        },
      ],
    },
  },
  projects: [
    {
      name: 'chromium',
      use: { 
        ...devices['Desktop Chrome'],
        screen: undefined,
        launchOptions: {
          args: [webMcpEnabled ? '--enable-features=WebMCP' : '--disable-features=WebMCP'],
        },
      },
    },
  ],
});
