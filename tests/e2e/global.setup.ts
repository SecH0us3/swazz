// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { test as setup, expect } from '@playwright/test';
import { registerAndLogin } from './helpers';

setup('do login', async ({ page }) => {
  // Ensure we register a user under 20 chars
  // registerAndLogin produces prefix + 6 chars + _ + up to 3 chars = max 11 chars after prefix
  const usernamePrefix = 'glob';
  await registerAndLogin(page, usernamePrefix, true);
  
  // Save storage state into the file
  await page.context().storageState({ path: 'storageState.json' });
});
