import { test, expect } from '@playwright/test';

async function fillKVRow(row: any, key: string, value: string) {
  const keyInput = row.locator('input[placeholder="Header"], input[placeholder="Name"], input[placeholder="Key"], input[placeholder="Category (e.g. xss)"]');
  await keyInput.fill(key);
  await keyInput.press('Tab');
  await expect(keyInput).toHaveValue(key);
  
  const valInput = row.locator('input[placeholder="Value"], input[placeholder="Filename (in wordlists/ dir)"]');
  await valInput.fill(value);
  await valInput.press('Tab');
  await expect(valInput).toHaveValue(value);
}

test.describe('Project and Payload Settings E2E Tests', () => {
  test('should configure project settings, verify raw config, and toggle payload settings', async ({ page }) => {
    // 1. Navigate to the frontend dev server
    await page.goto('/');

    // 2. Handle Login/Registration: Register a unique user (under 20 characters)
    await page.locator('button.link-btn:has-text("Sign up")').click();

    const uniqueUsername = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    await page.locator('#username').fill(uniqueUsername);
    await page.locator('#password').fill('password123');
    await page.locator('#password').press('Enter');

    // Wait for the main layout to load
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });

    // 3. Open Project Settings page
    const moreSettingsBtn = page.locator('button:has-text("More Project Settings")');
    await expect(moreSettingsBtn).toBeVisible();
    await moreSettingsBtn.click();

    // Verify Project Settings header is visible
    const settingsHeader = page.locator('h1:has-text("Project Settings")');
    await expect(settingsHeader).toBeVisible();

    // 4. Modify Fuzzing & Performance settings
    const fuzzingTabBtn = page.locator('button.tab-bar-btn:has-text("Fuzzing & Performance")');
    await expect(fuzzingTabBtn).toBeVisible();
    await fuzzingTabBtn.click();

    const timeoutInput = page.locator('label:has-text("Individual Request Timeout (ms)") + input');
    await expect(timeoutInput).toBeVisible();
    await timeoutInput.fill('2500');

    const delayInput = page.locator('label:has-text("Delay Between Requests (ms)") + input');
    await expect(delayInput).toBeVisible();
    await delayInput.fill('100');

    // 5. Modify Anomalies & Security settings
    const anomaliesTabBtn = page.locator('button.tab-bar-btn:has-text("Anomalies & Security")');
    await expect(anomaliesTabBtn).toBeVisible();
    await anomaliesTabBtn.click();

    const bolaCheckbox = page.locator('label:has-text("Enable Broken Object Level Authorization (BOLA) checking") >> input[type="checkbox"]');
    await expect(bolaCheckbox).toBeVisible();
    await bolaCheckbox.check();
    await expect(bolaCheckbox).toBeChecked();

    const ssrfCheckbox = page.locator('label:has-text("Allow Scanner Private IP Scopes") >> input[type="checkbox"]');
    await expect(ssrfCheckbox).toBeVisible();
    await ssrfCheckbox.check();
    await expect(ssrfCheckbox).toBeChecked();

    // 6. Verify in Raw JSON Config
    const rawConfigTabBtn = page.locator('button.tab-bar-btn:has-text("Raw JSON Config")');
    await expect(rawConfigTabBtn).toBeVisible();
    await rawConfigTabBtn.click();

    const rawTextarea = page.locator('.card:has-text("Raw JSON Configuration") >> textarea.textarea');
    await expect(rawTextarea).toBeVisible();

    // Wait for the textarea to be populated with configuration JSON (race condition guard)
    await expect(rawTextarea).toHaveValue(/timeout_ms/);

    await expect.poll(async () => {
      try {
        return JSON.parse(await rawTextarea.inputValue());
      } catch {
        return null;
      }
    }).toMatchObject({
      settings: {
        timeout_ms: 2500,
        delay_between_requests_ms: 100,
        bola_testing: true,
      },
      security: {
        allow_private_ips: true,
      },
    });

    // Save configuration
    const saveBtn = page.locator('button:has-text("Save Configuration")');
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();

    // Verify success indicator
    const successMsg = page.locator('text=/Configuration updated successfully/');
    await expect(successMsg).toBeVisible();

    // 7. Go back to Dashboard
    const backBtn = page.locator('button:has-text("Back to Dashboard")');
    await expect(backBtn).toBeVisible();
    await backBtn.click();
    await expect(moreSettingsBtn).toBeVisible();

    // 8. Open Payload Settings Modal
    const payloadSettingsBtn = page.locator('button[title="Payload Settings"]');
    await expect(payloadSettingsBtn).toBeVisible();
    await payloadSettingsBtn.click();

    // Verify Modal Header
    const modalTitle = page.locator('.modal-header h2:has-text("Payload Settings")');
    await expect(modalTitle).toBeVisible();

    // Switch to "Malicious" profile tab in modal
    const maliciousTab = page.locator('.tabs-header button:has-text("Malicious")');
    await expect(maliciousTab).toBeVisible();
    await maliciousTab.click();

    // Check the first payload item, toggle it
    const firstCatalogItem = page.locator('.catalog-item').first();
    await expect(firstCatalogItem).toBeVisible();
    
    // Toggle the category (verifying initial checked state and toggling off)
    const checkboxInItem = firstCatalogItem.locator('input[type="checkbox"]');
    await expect(checkboxInItem).toBeChecked();
    await firstCatalogItem.click();
    await expect(checkboxInItem).not.toBeChecked();

    // Close Modal by pressing Escape
    await page.keyboard.press('Escape');
    await expect(modalTitle).not.toBeVisible();
  });

  test('should verify settings have actual effect on fuzzer and cover General, Chaining, and Wordlists tabs', async ({ page }) => {
    // 1. Navigate to the frontend dev server
    await page.goto('/');

    // 2. Handle Login/Registration: Register a unique user
    await page.locator('button.link-btn:has-text("Sign up")').click();

    const uniqueUsername = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    await page.locator('#username').fill(uniqueUsername);
    await page.locator('#password').fill('password123');
    await page.locator('#password').press('Enter');

    // Wait for the main layout to load
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });

    // 3. Open Project Settings page
    const moreSettingsBtn = page.locator('button:has-text("More Project Settings")');
    await expect(moreSettingsBtn).toBeVisible();
    await moreSettingsBtn.click();

    // 4. Test General Tab changes
    const generalTabBtn = page.locator('button.tab-bar-btn:has-text("General")');
    await expect(generalTabBtn).toBeVisible();
    await generalTabBtn.click();

    const nameInput = page.locator('label:has-text("Project Name") + input');
    await expect(nameInput).toBeVisible();
    await nameInput.fill('E2E Configured Project');

    const descTextarea = page.locator('label:has-text("Description") + textarea');
    await expect(descTextarea).toBeVisible();
    await descTextarea.fill('E2E Description');

    const targetInput = page.locator('label:has-text("Target Base URL") + input');
    await expect(targetInput).toBeVisible();
    await targetInput.fill('http://127.0.0.1:8788');

    const saveGeneralBtn = page.locator('button:has-text("Save General Info")');
    await expect(saveGeneralBtn).toBeVisible();
    await saveGeneralBtn.click();

    const generalSavedText = page.locator('text=/Saved successfully/');
    await expect(generalSavedText).toBeVisible({ timeout: 10000 });

    // 5. Test Wordlists Tab
    const wordlistsTabBtn = page.locator('button.tab-bar-btn:has-text("Wordlist Files")');
    await expect(wordlistsTabBtn).toBeVisible();
    await wordlistsTabBtn.click();

    const wordlistsCard = page.locator('.card:has-text("Wordlist Files Configuration")');
    const wordlistAddBtn = wordlistsCard.locator('button.kv-add');
    await expect(wordlistAddBtn).toBeVisible();
    await wordlistAddBtn.click();

    const lastRowWordlist = wordlistsCard.locator('.kv-row').last();
    await fillKVRow(lastRowWordlist, 'xss', 'xss-custom.txt');

    // 6. Test Chaining Tab
    const chainingTabBtn = page.locator('button.tab-bar-btn:has-text("Request Chaining")');
    await expect(chainingTabBtn).toBeVisible();
    await chainingTabBtn.click();

    const ruleAddBtn = page.locator('button.chaining-rule-add-btn');
    await expect(ruleAddBtn).toBeVisible();
    await ruleAddBtn.click();

    const ruleCard = page.locator('.chaining-rule-card').first();
    await expect(ruleCard).toBeVisible();

    const sourceInput = ruleCard.locator('label:has-text("Source Endpoint") + input');
    await sourceInput.fill('POST /api/login');

    const varInput = ruleCard.locator('label:has-text("Variable Name") + input');
    await varInput.fill('SESSION_TOKEN');

    const pathInput = ruleCard.locator('label:has-text("Extract Path / Regex") + input');
    await pathInput.fill('data.session_id');

    // 7. Verify the inputs were serialized in JSON config correctly
    const rawConfigTabBtn = page.locator('button.tab-bar-btn:has-text("Raw JSON Config")');
    await expect(rawConfigTabBtn).toBeVisible();
    await rawConfigTabBtn.click();

    const rawTextarea = page.locator('.card:has-text("Raw JSON Configuration") >> textarea.textarea');
    await expect(rawTextarea).toBeVisible();

    // Verify raw configuration JSON matches our inputs
    await expect.poll(async () => {
      try {
        return JSON.parse(await rawTextarea.inputValue());
      } catch {
        return null;
      }
    }).toMatchObject({
      base_url: 'http://127.0.0.1:8788',
      wordlist_files: {
        xss: 'xss-custom.txt',
      },
      settings: {
        chaining_rules: [
          {
            source_endpoint: 'POST /api/login',
            extract_type: 'json',
            extract_path: 'data.session_id',
            variable_name: 'SESSION_TOKEN',
          }
        ]
      }
    });

    // 8. Now set the timeout to 1ms to test the settings have actual effect on fuzzing
    const fuzzingTabBtn = page.locator('button.tab-bar-btn:has-text("Fuzzing & Performance")');
    await expect(fuzzingTabBtn).toBeVisible();
    await fuzzingTabBtn.click();

    const timeoutInput = page.locator('label:has-text("Individual Request Timeout (ms)") + input');
    await expect(timeoutInput).toBeVisible();
    await timeoutInput.fill('1'); // 1ms timeout!

    // Switch to Raw JSON Config tab to save the configuration
    const rawConfigTabBtnSecond = page.locator('button.tab-bar-btn:has-text("Raw JSON Config")');
    await expect(rawConfigTabBtnSecond).toBeVisible();
    await rawConfigTabBtnSecond.click();

    // Save configuration
    const saveBtn = page.locator('button:has-text("Save Configuration")');
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();

    const successMsg = page.locator('text=/Configuration updated successfully/');
    await expect(successMsg).toBeVisible();

    // 9. Go back to Dashboard and run fuzzer
    const backBtn = page.locator('button:has-text("Back to Dashboard")');
    await expect(backBtn).toBeVisible();
    await backBtn.click();
    await expect(moreSettingsBtn).toBeVisible();

    // Set intensity to 1 and disable heavy profiles to speed up E2E test
    const profilesSection = page.locator('.sidebar-section:has-text("Profiles")');
    const intensityInput = profilesSection.locator('input[type="number"]').first();
    await intensityInput.fill('1');

    const boundaryToggle = profilesSection.locator('.profile-toggle.boundary');
    await expect(boundaryToggle).toHaveClass(/active/);
    await boundaryToggle.click();
    await expect(boundaryToggle).not.toHaveClass(/active/);

    const maliciousToggle = profilesSection.locator('.profile-toggle.malicious');
    await expect(maliciousToggle).toHaveClass(/active/);
    await maliciousToggle.click();
    await expect(maliciousToggle).not.toHaveClass(/active/);

    // Add Vulnerable Demo spec
    const specUrlInput = page.locator('input[placeholder="https://api.com/swagger.json or /graphql"]');
    await specUrlInput.fill('http://127.0.0.1:8788/swagger.json');
    const addBtn = page.locator('button.btn-primary:has-text("Add")');
    await addBtn.click();

    const endpointItems = page.locator('.tree-leaf-row');
    await expect(endpointItems.first()).toBeVisible({ timeout: 15000 });

    // Trigger fuzzing
    const startBtn = page.locator('#btn-start');
    await expect(startBtn).toBeVisible();
    await startBtn.click();

    // Wait for the fuzzer to complete (timeout of 1ms makes it complete/fail almost instantly)
    await expect(startBtn).toBeVisible({ timeout: 20000 });

    // 10. Verify that the 1ms timeout had an effect by checking that total requests ran but 2xx success count is 0
    const totalStat = page.locator('.stat-card.stat-total .stat-value');
    await expect(totalStat).not.toHaveText('0');

    const successStat = page.locator('.stat-card.stat-2xx .stat-value');
    await expect(successStat).toHaveText('0');

    // 11. Cleanup: restore default settings to prevent polluting coordinator database for other tests
    await moreSettingsBtn.click();
    await fuzzingTabBtn.click();
    await timeoutInput.fill('2000');
    await rawConfigTabBtnSecond.click();
    await saveBtn.click();
    await expect(successMsg).toBeVisible();

    // Restore boundary/malicious profiles and intensity back to default (Boundary, Malicious active, intensity 5)
    await backBtn.click();
    await expect(moreSettingsBtn).toBeVisible();
    await intensityInput.fill('5');
    await boundaryToggle.click();
    await expect(boundaryToggle).toHaveClass(/active/);
    await maliciousToggle.click();
    await expect(maliciousToggle).toHaveClass(/active/);
  });
});
