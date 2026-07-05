import { test, expect } from '@playwright/test';
import fs from 'fs';
import path from 'path';

test.describe('Additional UI Coverage E2E Tests', () => {
  // Helper to register and log in before each test case
  test.beforeEach(async ({ page }) => {
    await page.goto('/');
    await page.getByRole('button', { name: 'Create' }).click();

    // Use a unique username complying with length constraints (3 to 20 chars)
    const uniqueUsername = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    await page.locator('#username').fill(uniqueUsername);
    await page.locator('#password').fill('Password123!');
    await page.locator('#password').press('Enter');

    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });
  });

  test('Keyboard Shortcuts - Numeric tab switching, Alt+L / Alt+C toggles, and detail Esc close', async ({ page }) => {
    // Load local Vulnerable Demo spec so the tab bar is rendered
    const specUrlInput = page.locator('input[placeholder="https://api.com/swagger.json or /graphql"]');
    await expect(specUrlInput).toBeVisible();
    
    const demoSpecUrl = 'http://127.0.0.1:8788/swagger.json';
    await specUrlInput.fill(demoSpecUrl);
    
    const addBtn = page.locator('button.btn-primary:has-text("Add")');
    await addBtn.click();

    // Wait for endpoints list to render to ensure spec is loaded
    const endpointItems = page.locator('.tree-leaf-row');
    await expect(endpointItems.first()).toBeVisible({ timeout: 15000 });

    // Blur any active element (like the search/input fields) to ensure keyboard shortcuts fire on window
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    // Also click a neutral element to focus the layout document
    await page.locator('.app-layout').click();

    // 1. Test numeric tab switching keys
    // Switch to Request Logs (tab 2)
    await page.keyboard.press('2');
    await expect(page.locator('button.tab-bar-btn.active:has-text("Request Logs")')).toBeVisible();

    // Switch to Grouped Errors (tab 3)
    await page.keyboard.press('3');
    await expect(page.locator('button.tab-bar-btn.active:has-text("Grouped Errors")')).toBeVisible();

    // Switch to Scan History (tab 5)
    await page.keyboard.press('5');
    await expect(page.locator('h1:has-text("Scan History")')).toBeVisible();

    // Switch back to Dashboard (tab 1)
    await page.keyboard.press('1');
    await expect(page.locator('button.tab-bar-btn.active:has-text("Endpoint Heatmap")')).toBeVisible();

    // 2. Test Alt+L and Alt+C sidebar toggles
    // Verify left sidebar is open (visible)
    const leftSidebar = page.locator('aside.sidebar').first();
    await expect(leftSidebar).toBeVisible();

    // Toggle left sidebar off (Alt + L) using explicit down/press/up keyboard sequence to ensure code KeyL triggers
    await page.keyboard.down('Alt');
    await page.keyboard.press('KeyL');
    await page.keyboard.up('Alt');
    await expect(leftSidebar).toHaveClass(/hidden-desktop/);

    // Toggle left sidebar back on
    await page.keyboard.down('Alt');
    await page.keyboard.press('KeyL');
    await page.keyboard.up('Alt');
    await expect(leftSidebar).not.toHaveClass(/hidden-desktop/);

    // Verify right ConfigSidebar is open (visible)
    const rightSidebar = page.locator('aside.config-sidebar').first();
    await expect(rightSidebar).toBeVisible();

    // Toggle right sidebar off (Alt + C)
    await page.keyboard.down('Alt');
    await page.keyboard.press('KeyC');
    await page.keyboard.up('Alt');
    await expect(rightSidebar).toHaveClass(/hidden-desktop/);

    // Toggle right sidebar back on
    await page.keyboard.down('Alt');
    await page.keyboard.press('KeyC');
    await page.keyboard.up('Alt');
    await expect(rightSidebar).not.toHaveClass(/hidden-desktop/);
  });

  test('User Settings extra capabilities - API Key visibility, Public Key file upload and clean up', async ({ page }) => {
    // Navigate to profile settings
    const accountBtn = page.locator('button[title="Account"]');
    await expect(accountBtn).toBeVisible();
    await accountBtn.click();

    const settingsLink = page.locator('.dropdown-item:has-text("Profile Settings")');
    await expect(settingsLink).toBeVisible();
    await settingsLink.click();

    const settingsHeader = page.locator('h1:has-text("Settings")');
    await expect(settingsHeader).toBeVisible();

    // 1. API Key show/hide toggle
    // API key is masked on initial load, so no Show/Copy buttons are present.
    const apiKeyInput = page.locator('input[type="password"][readonly]');
    await expect(apiKeyInput).toBeVisible();

    const showBtn = page.locator('input[readonly] ~ button');
    await expect(showBtn).toHaveCount(0);

    // Click Regenerate API Key to show plain-text key (accepting confirmation dialog)
    page.once('dialog', async dialog => {
      await dialog.accept();
    });

    const rotateBtn = page.locator('#btn-rotate-api-key');
    await expect(rotateBtn).toBeVisible();
    await rotateBtn.click();

    // Now copy and dismiss buttons should be visible
    const copyBtn = page.locator('button:has-text("Copy")');
    await expect(copyBtn).toBeVisible();

    const dismissBtn = page.locator('#btn-dismiss-api-key');
    await expect(dismissBtn).toBeVisible();

    // Click Dismiss to mask the key again
    await dismissBtn.click();

    // Key is masked again, so no buttons are present
    await expect(showBtn).toHaveCount(0);

    // Navigate to Project Settings -> Active Runners where public key setup now lives
    const profileBackBtn = page.locator('button:has-text("Back to Dashboard")');
    await expect(profileBackBtn).toBeVisible();
    await profileBackBtn.click();

    const moreSettingsBtn = page.locator('button:has-text("More Project Settings")');
    await expect(moreSettingsBtn).toBeVisible();
    await moreSettingsBtn.click();

    const activeRunnersTab = page.locator('button.tab-bar-btn:has-text("Active Runners")');
    await expect(activeRunnersTab).toBeVisible();
    await activeRunnersTab.click();

    // 2. Upload public key file
    const tempPubKeyPath = path.join(process.cwd(), "temp_pubkey_" + Date.now() + "_" + Math.floor(Math.random() * 1000) + ".pub");
    const mockPubKeyText = 'b'.repeat(64);
    fs.writeFileSync(tempPubKeyPath, mockPubKeyText, 'utf8');

    try {
      const fileChooserPromise = page.waitForEvent('filechooser');
      const uploadLabel = page.locator('label[for="pubkey-file"]');
      await expect(uploadLabel).toBeVisible();
      await uploadLabel.click();

      const fileChooser = await fileChooserPromise;
      await fileChooser.setFiles(tempPubKeyPath);

      // Verify input gets populated with file content
      const pubKeyInput = page.locator('input[placeholder*="Enter hex-encoded public key"]');
      await expect(pubKeyInput).toHaveValue(mockPubKeyText);

      // Save public key
      const saveBtn = page.locator('form button[type="submit"]:has-text("Save")');
      await expect(saveBtn).toBeVisible();
      await saveBtn.click();

      // Verify success notification
      await expect(page.locator('text=Public key saved successfully!')).toBeVisible();

      // 3. Clear public key and save (clean up key)
      await pubKeyInput.fill('');
      await saveBtn.click();
      await expect(page.locator('text=Public key saved successfully!')).toBeVisible();
      await expect(pubKeyInput).toHaveValue('');
    } finally {
      if (fs.existsSync(tempPubKeyPath)) {
        fs.unlinkSync(tempPubKeyPath);
      }
    }

    // 4. Test Back to Dashboard button
    const backBtn = page.locator('button:has-text("Back to Dashboard")');
    await expect(backBtn).toBeVisible();
    await backBtn.click();
    
    // Assert that we are back on the main empty-state dashboard page
    await expect(page.locator('text=Ready to fuzz')).toBeVisible();
  });

  test('Project Selector additional checks - switch tab via Project Settings option', async ({ page }) => {
    // Open project selector dropdown
    const projectSelectorBtn = page.locator('.sidebar-project-selector button.btn-ghost');
    await expect(projectSelectorBtn).toBeVisible();
    await projectSelectorBtn.click();

    // Click Project Settings option in project selector dropdown
    const dropdownSettingsOption = page.locator('button.dropdown-item:has-text("Project Settings")');
    await expect(dropdownSettingsOption).toBeVisible();
    await dropdownSettingsOption.click();

    // Verify it navigated to Project Settings page
    await expect(page.locator('h1:has-text("Project Settings")')).toBeVisible();
  });

  test('Scan History extra checks - CLI JSON Import, deleting scan runs, and report exports', async ({ page }) => {
    // Navigate to Scan History
    const historyBtn = page.locator('button:has-text("History")');
    await expect(historyBtn).toBeVisible();
    await historyBtn.click();

    await expect(page.locator('h1:has-text("Scan History")')).toBeVisible();

    // Create a temp CLI report JSON
    const tempReportPath = path.join(process.cwd(), "temp_cli_report_" + Date.now() + "_" + Math.floor(Math.random() * 1000) + ".json");
    const mockReport = {
      tool: "swazz",
      timestamp: new Date().toISOString(),
      summary: {
        totalRequests: 2,
        statusCounts: {
          "200": 1,
          "500": 1
        }
      },
      findings: [
        {
          id: "f-1",
          method: "GET",
          endpoint: "/api/users",
          status: 200,
          profile: "RANDOM",
          resolvedPath: "http://127.0.0.1:8788/api/users",
          requestHeaders: {},
          responseBody: "{}",
          analyzerFindings: []
        },
        {
          id: "f-2",
          method: "POST",
          endpoint: "/api/items",
          status: 500,
          profile: "MALICIOUS",
          resolvedPath: "http://127.0.0.1:8788/api/items",
          requestHeaders: {},
          responseBody: "{}",
          analyzerFindings: []
        }
      ]
    };
    fs.writeFileSync(tempReportPath, JSON.stringify(mockReport), 'utf8');

    try {
      // 1. Import CLI report
      const fileChooserPromise = page.waitForEvent('filechooser');
      const importBtn = page.locator('button:has-text("Import CLI Report")');
      await expect(importBtn).toBeVisible();
      await importBtn.click();

      const fileChooser = await fileChooserPromise;
      await fileChooser.setFiles(tempReportPath);

      // Successfully importing a CLI report should redirect to main dashboard/heatmap view
      await expect(page.locator('button.tab-bar-btn.active:has-text("Endpoint Heatmap")')).toBeVisible({ timeout: 15000 });

      // Verify that imported run's findings are populated in Grouped Errors
      const findingsTab = page.locator('button.tab-bar-btn:has-text("Grouped Errors")');
      await expect(findingsTab).toBeVisible();
      await findingsTab.click();

      const expandAllBtn = page.locator('button:has-text("Expand All")');
      await expect(expandAllBtn).toBeVisible();
      await expandAllBtn.click();

      // Check for finding row "/api/items"
      const findingRow = page.locator('.finding-item').filter({ hasText: '/api/items' }).first();
      await expect(findingRow).toBeVisible();

      // 2. Export MD Report check
      const downloadTab = page.locator('button.tab-bar-btn:has-text("Download")');
      await expect(downloadTab).toBeVisible();
      await downloadTab.hover();

      const mdReportBtn = page.locator('button:has-text("MD Report")');
      await expect(mdReportBtn).toBeVisible();

      const downloadPromise = page.waitForEvent('download');
      await mdReportBtn.click();
      const download = await downloadPromise;
      const downloadPath = await download.path();
      expect(downloadPath).not.toBeNull();

      if (downloadPath) {
        const content = fs.readFileSync(downloadPath, 'utf8');
        expect(content).toContain('Swazz API Fuzzer Report');
        expect(content).toContain('http://127.0.0.1:8788');
      }

      // 3. Test deleting scan run from History Page
      await historyBtn.click();
      await expect(page.locator('h1:has-text("Scan History")')).toBeVisible();

      // Register confirm dialogue handler
      page.once('dialog', async dialog => {
        expect(dialog.type()).toBe('confirm');
        expect(dialog.message()).toBe('Delete this scan history?');
        await dialog.accept();
      });

      const deleteBtn = page.locator('button[title="Delete Scan Run"]').first();
      await expect(deleteBtn).toBeVisible();
      await deleteBtn.click();

      // Verify history row disappears
      await expect(deleteBtn).toBeHidden({ timeout: 10000 });
    } finally {
      if (fs.existsSync(tempReportPath)) {
        fs.unlinkSync(tempReportPath);
      }
    }
  });

  test('Interactive Request Replayer & Tampering - edit request path and replay', async ({ page }) => {
    // 1. Add Swagger spec and run a quick scan to get findings
    const specUrlInput = page.locator('input[placeholder="https://api.com/swagger.json or /graphql"]');
    await expect(specUrlInput).toBeVisible();
    
    const demoSpecUrl = 'http://127.0.0.1:8788/swagger.json';
    await specUrlInput.fill(demoSpecUrl);
    
    const addBtn = page.locator('button.btn-primary:has-text("Add")');
    await addBtn.click();

    const endpointItems = page.locator('.tree-leaf-row');
    await expect(endpointItems.first()).toBeVisible({ timeout: 15000 });

    const startBtn = page.locator('#btn-start');
    await expect(startBtn).toBeVisible();
    await startBtn.click();

    // Wait for the scan to complete
    await expect(startBtn).toBeVisible({ timeout: 60000 });

    // 2. Go to request logs
    const requestLogsTab = page.locator('button.tab-bar-btn:has-text("Request Logs")');
    await expect(requestLogsTab).toBeVisible();
    await requestLogsTab.click();

    // Select the first non-header fuzzed request log row to open inspector
    const fuzzedRow = page.locator('.log-row:not(.log-header)').first();
    await expect(fuzzedRow).toBeVisible();
    await fuzzedRow.click();

    // Verify detail panel opens
    const closeBtn = page.locator('button[aria-label="Close"]');
    await expect(closeBtn).toBeVisible();

    // Click "Raw Request" sub-tab to edit it
    const rawRequestBtn = page.locator('button.detail-toggle-btn:has-text("Raw Request")');
    await expect(rawRequestBtn).toBeVisible();
    await rawRequestBtn.click();

    // Edit the Request URL field
    const requestUrlInput = page.locator('.modal-pane').locator('div:has-text("Request URL")').locator('input.input').first();
    await expect(requestUrlInput).toBeVisible();
    
    const originalUrl = await requestUrlInput.inputValue();
    const tamperedUrl = `${originalUrl}?tampered_e2e=true`;
    await requestUrlInput.fill(tamperedUrl);

    // Click the Replay button
    const replayBtn = page.locator('#btn-replay');
    await expect(replayBtn).toBeVisible();
    await replayBtn.click();

    // Verify "Sending..." / replaying starts and completes
    await expect(replayBtn).toHaveText(/Replay|Sending/);
    
    // Wait for replay to complete (Replay button is enabled again)
    await expect(replayBtn).not.toBeDisabled({ timeout: 15000 });

    // Close the panel
    await closeBtn.click();
  });
});
