import { test, expect } from '@playwright/test';

test.describe('Scan Scheduler & Timeout E2E Tests', () => {
  test('should restrict scheduling to Supporter Plan, allow saving valid cron, reject fast cron, support scan timeout, and reconnect on refresh', async ({ page }) => {
    // Enable diagnostics logging
    page.on('console', msg => console.log(`BROWSER CONSOLE [${msg.type()}]: ${msg.text()}`));
    page.on('pageerror', exception => console.log(`BROWSER EXCEPTION: ${exception}`));
    page.on('requestfailed', req => console.log(`BROWSER REQUEST FAILED: ${req.url()} - ${req.failure()?.errorText}`));
    page.on('response', res => {
      if (res.status() >= 400) {
        console.log(`BROWSER RESPONSE ERROR: ${res.url()} -> ${res.status()}`);
      }
    });

    // 1. Navigate to frontend & register a new user
    await page.goto('/');

    const createAccountBtn = page.getByRole('button', { name: 'Create' });
    await expect(createAccountBtn).toBeVisible();
    await createAccountBtn.click();

    // Short username under 20 chars limit (Rule: username length validation 3 to 20 chars)
    const username = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    await page.locator('#username').fill(username);
    await page.locator('#password').fill('Password123!');
    const configPromise = page.waitForResponse(resp => resp.url().includes('/config') && resp.status() === 200);
    await page.locator('#password').press('Enter');

    // Wait for the main dashboard to load
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });
    await configPromise;

    // Add Vulnerable Demo API swagger spec so we have endpoints to scan
    const specUrlInput = page.locator('input[placeholder="https://api.com/swagger.json or /graphql"]');
    await expect(specUrlInput).toBeVisible();

    const configPromise2 = page.waitForResponse(resp => resp.url().includes('/config') && resp.request().method() === 'POST' && resp.status() === 200);
    await specUrlInput.fill('http://127.0.0.1:8788/swagger.json');
    const addBtn = page.locator('button.btn-primary:has-text("Add")');
    await addBtn.click();
    await configPromise2;

    const endpointItems = page.locator('.tree-leaf-row');
    await expect(endpointItems.first()).toBeVisible({ timeout: 15000 });

    // 2. Open Project Settings page
    const moreSettingsBtn = page.locator('button:has-text("More Project Settings")');
    await expect(moreSettingsBtn).toBeVisible();
    await moreSettingsBtn.click();

    // Verify Project Settings header is visible
    const settingsHeader = page.locator('h1:has-text("Project Settings")');
    await expect(settingsHeader).toBeVisible();

    // 3. Navigate to Scan Scheduler tab (should see blocked banner initially)
    const schedulerTabBtn = page.locator('button.tab-bar-btn:has-text("Scan Scheduler")');
    await expect(schedulerTabBtn).toBeVisible();
    await schedulerTabBtn.click();

    // Should see premium feature notice
    await expect(page.locator('text=Supporter Plan Required')).toBeVisible();

    // 4. Upgrade user plan using the Admin API
    const upgradeRes = await page.evaluate(async () => {
      const token = localStorage.getItem('swazz_token');
      // Retrieve profile first to get userId/username
      const meRes = await fetch('/api/auth/me', {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const me = await meRes.json();
      
      const res = await fetch('/api/admin/users/plan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'test-admin-secret'
        },
        body: JSON.stringify({
          username: me.username,
          plan: 'Supporter Plan'
        })
      });
      return res.status;
    });
    expect(upgradeRes).toBe(200);

    // Refresh page to load upgraded plan
    const reloadConfigPromise = page.waitForResponse(resp => resp.url().includes('/config') && resp.status() === 200);
    const reloadMePromise = page.waitForResponse(resp => resp.url().includes('/api/auth/me') && resp.status() === 200);
    await page.reload();
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });
    await reloadConfigPromise;
    await reloadMePromise;

    // Go back to Project Settings -> Scan Scheduler
    const moreSettingsBtn2 = page.locator('button:has-text("More Project Settings")');
    await expect(moreSettingsBtn2).toBeVisible();
    await moreSettingsBtn2.click();
    
    const schedulerTabBtn2 = page.locator('button.tab-bar-btn:has-text("Scan Scheduler")');
    await expect(schedulerTabBtn2).toBeVisible();
    const configFetchPromise = page.waitForResponse(resp => resp.url().includes('/config') && resp.request().method() === 'GET' && resp.status() === 200);
    await schedulerTabBtn2.click();
    await configFetchPromise;

    // Premium banner should now be gone, and frequency select should be visible
    await expect(page.locator('label:has-text("Schedule Frequency")')).toBeVisible();

    // 5. Select custom cron and input invalid frequency (e.g. hourly `0 * * * *`)
    await page.locator('select.schedule-select').selectOption('custom');
    const cronInput = page.locator('input.schedule-input');
    await expect(cronInput).toBeVisible();
    await cronInput.fill('0 * * * *');

    const saveBtn = page.locator('button:has-text("Save Schedule")');
    await saveBtn.click();

    // Should show validation toast/alert
    await expect(page.locator('text=Frequency limit')).toBeVisible();

    // 6. Set valid daily cron `0 12 * * *` and save successfully
    await cronInput.fill('0 12 * * *');
    await saveBtn.click();
    await expect(page.locator('text=Schedule settings saved successfully')).toBeVisible();

    // 7. Test Scan Timeout
    // Open Performance sub-tab
    const performanceTabBtn = page.locator('button.tab-bar-btn:has-text("Fuzzing & Performance")');
    await expect(performanceTabBtn).toBeVisible();
    await performanceTabBtn.click();

    // Fill "Maximum Scan Duration (minutes)" with 1
    const timeoutInput = page.locator('input.input-width-md');
    await expect(timeoutInput).toBeVisible();
    const timeoutSavePromise = page.waitForResponse(resp => resp.url().includes('/config') && resp.request().method() === 'POST' && resp.status() === 200);
    await timeoutInput.fill('1');
    await timeoutSavePromise;

    // 8. Reconnect on Page Reload
    // Press escape to close the settings modal
    await page.keyboard.press('Escape');

    // Click "Start Scan" (id="btn-start")
    const startFuzzBtn = page.locator('#btn-start');
    await expect(startFuzzBtn).toBeVisible();
    await startFuzzBtn.click();

    // Wait for run to get active
    await page.waitForTimeout(1500);

    // Reload the page
    const reconnectConfigPromise = page.waitForResponse(resp => resp.url().includes('/config') && resp.status() === 200);
    const reconnectMePromise = page.waitForResponse(resp => resp.url().includes('/api/auth/me') && resp.status() === 200);
    await page.reload();
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });
    await reconnectConfigPromise;
    await reconnectMePromise;

    // Verify it automatically reconnected to the running session
    await expect(page.locator('button.btn-danger[title="Stop"]')).toBeVisible({ timeout: 15000 });
  });
});
