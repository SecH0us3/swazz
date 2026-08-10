// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { Page } from '@playwright/test';

/** Disable contextual tours so they never interfere with functional E2E specs. */
export async function disableTours(page: Page) {
  await page.addInitScript(() => {
    localStorage.setItem('swazz_tours_disabled', 'true');
    localStorage.setItem('swazz_tour_completed', '["workspace-first","project-settings-first"]');
  });
}

/** Explicitly re-enable tours for tour-specific E2E tests. */
export async function enableTours(page: Page) {
  await page.addInitScript(() => {
    localStorage.removeItem('swazz_tours_disabled');
    localStorage.removeItem('swazz_tour_completed');
  });
}
