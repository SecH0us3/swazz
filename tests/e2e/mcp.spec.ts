import { test, expect } from '@playwright/test';

test.describe('MCP and API Key Hashing E2E Tests', () => {
  test('should display masked key, support rotation and show plain-text key once', async ({ page }) => {
    // 1. Navigate to the frontend
    await page.goto('/');
    await page.getByRole('button', { name: 'Sign In' }).click();

    // 2. Register a unique user
    await page.getByRole('button', { name: 'Create an account' }).click();

    const uniqueUsername = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    await page.locator('#username').fill(uniqueUsername);
    await page.locator('#password').fill('Password123!');
    await page.locator('#password').press('Enter');

    // Wait for the main layout to load
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });

    // 3. Open Profile Settings
    const accountBtn = page.locator('button[title="Account"]');
    await expect(accountBtn).toBeVisible();
    await accountBtn.click();

    const settingsLink = page.locator('.dropdown-item:has-text("Profile Settings")');
    await expect(settingsLink).toBeVisible();
    await settingsLink.click();

    // Verify Settings screen is loaded
    const settingsHeader = page.locator('h1:has-text("Settings")');
    await expect(settingsHeader).toBeVisible();

    // 4. Verify initial API Key input is present and masked
    const apiKeyInput = page.locator('.settings-input-monospace');
    await expect(apiKeyInput).toBeVisible();
    await expect(apiKeyInput).toHaveValue(/swazz_live_.*•/);

    // 5. Setup confirm dialog handler to accept key regeneration
    page.on('dialog', async dialog => {
      expect(dialog.message()).toContain('Are you sure you want to regenerate your API key?');
      await dialog.accept();
    });

    // 6. Click the Regenerate API Key button
    const rotateBtn = page.locator('#btn-rotate-api-key');
    await expect(rotateBtn).toBeVisible();
    await rotateBtn.click();

    // 7. Verify new API Key alert is shown with plain text key
    const newAlert = page.locator('.api-key-new-alert');
    await expect(newAlert).toBeVisible();

    const newApiKeyInput = newAlert.locator('.settings-input-monospace');
    await expect(newApiKeyInput).toBeVisible();
    await expect(newApiKeyInput).toHaveValue(/swazz_live_/);
    await expect(newApiKeyInput).not.toHaveValue(/•/);

    // Click Dismiss button
    const dismissBtn = page.locator('#btn-dismiss-api-key');
    await expect(dismissBtn).toBeVisible();
    await dismissBtn.click();

    // Verify the alert is gone
    await expect(newAlert).toBeHidden();

    // 8. Reload page to verify that the key returns to being masked
    await page.reload();
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });

    // Navigate back to Profile Settings
    await accountBtn.click();
    await settingsLink.click();
    await expect(settingsHeader).toBeVisible();

    // Verify it is masked again
    const apiInputReloaded = page.locator('.settings-input-monospace');
    await expect(apiInputReloaded).toBeVisible();
    await expect(apiInputReloaded).toHaveValue(/swazz_live_.*•/);
  });

  test('should support MCP server fuzzing and detect crashes/exceptions in MCP tools', async ({ page }) => {
    // 1. Navigate to the frontend
    page.on('console', msg => console.log('BROWSER CONSOLE:', msg.text()));
    await page.goto('/');
    await page.getByRole('button', { name: 'Sign In' }).click();

    // 2. Register a unique user
    await page.getByRole('button', { name: 'Create an account' }).click();

    const uniqueUsername = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    await page.locator('#username').fill(uniqueUsername);
    await page.locator('#password').fill('Password123!');
    await page.locator('#password').press('Enter');

    // Wait for the main layout to load
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });

    // 3. Open More Project Settings to access Raw JSON Config
    const moreSettingsBtn = page.locator('button:has-text("More Project Settings")');
    await expect(moreSettingsBtn).toBeVisible();
    await moreSettingsBtn.click();

    // Go to Raw JSON Config tab
    const rawConfigTabBtn = page.locator('button.tab-bar-btn:has-text("Raw JSON Config")');
    await expect(rawConfigTabBtn).toBeVisible();
    await rawConfigTabBtn.click();

    // Get the current config text, parse it, merge our mcpServer settings, and save it
    const textarea = page.locator('textarea.textarea');
    await expect(textarea).toBeVisible();
    const currentConfigText = await textarea.inputValue();
    const config = JSON.parse(currentConfigText);

    // Merge MCP Server config
    config.mcp_server = {
      type: "stdio",
      command: "node",
      args: ["demo/mcp-stdio.js"]
    };
    // Keep intensity low
    config.settings.profiles = ["RANDOM", "MALICIOUS", "BOUNDARY"];
    config.settings.intensity = 2;

    await textarea.fill(JSON.stringify(config, null, 2));

    const saveBtn = page.locator('button:has-text("Save Configuration")');
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();

    const successMsg = page.locator('text=/Configuration updated successfully/');
    await expect(successMsg).toBeVisible();

    // Go back to Dashboard
    const backBtn = page.locator('button:has-text("Back to Dashboard")');
    await expect(backBtn).toBeVisible();
    await backBtn.click();

    // Since our mcp_server config automatically generates virtual endpoints, we don't need a Swagger URL.
    // However, the UI requires some input to start or we must ensure there are endpoints.
    // The mapped endpoints "mcp://tool/get_info" and "mcp://tool/query_db" will automatically populate during initRun!
    // But to bypass any client-side schema checks, let's also fill a dummy Swagger URL.
    const specUrlInput = page.locator('input[placeholder="https://api.com/swagger.json or /graphql"]');
    await expect(specUrlInput).toBeVisible();
    const demoSpecUrl = 'http://127.0.0.1:8788/swagger.json';
    await specUrlInput.fill(demoSpecUrl);

    const addBtn = page.locator('button.btn-primary:has-text("Add")');
    await addBtn.click();

    // Verify spec is loaded and endpoints list is visible
    await expect(page.locator('.swagger-url-text')).toHaveText(demoSpecUrl);
    const endpointItems = page.locator('.tree-leaf-row');
    await expect(endpointItems.first()).toBeVisible({ timeout: 15000 });

    // 4. Click Start
    const startBtn = page.locator('#btn-start');
    await expect(startBtn).toBeVisible();
    await startBtn.click();

    // Wait for the stop button to show (fuzzing in progress) and then the start button to reappear (fuzzing completed)
    const stopBtn = page.locator('button.btn-danger[title="Stop"]');
    await expect(stopBtn).toBeVisible({ timeout: 10000 });
    await expect(startBtn).toBeVisible({ timeout: 60000 });

    // 5. Verify MCP findings under OWASP Top 10 tab
    const owaspTab = page.locator('button.tab-bar-btn:has-text("OWASP Top 10")');
    await expect(owaspTab).toBeVisible();
    await owaspTab.click();

    // Verify summary count reflects finding(s)
    const summaryBanner = page.locator('.owasp-summary-count');
    await expect(summaryBanner).toHaveText(/\d+ Finding[s]? Detected/, { timeout: 10000 });

    // Verify A10:2025 Mishandling of Exceptional Conditions category card has findings (our mcp server crash finding)
    const mcpCrashCard = page.locator('.owasp-card:has-text("A10:2025")');
    await expect(mcpCrashCard).toBeVisible({ timeout: 10000 });
    await expect(mcpCrashCard).toHaveClass(/has-findings/);
    await mcpCrashCard.click();

    // Check that a finding for /mcp/sse or mcp://tool/query_db exists
    const findingRow = page.locator('.owasp-accordion:has-text("A10:2025") .owasp-finding-row').filter({ hasText: 'mcp://tool/query_db' }).first();
    await expect(findingRow).toBeVisible({ timeout: 10000 });
  });
});
