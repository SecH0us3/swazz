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
    await page.getByRole('button', { name: 'Sign In' }).click();

    // 2. Handle Login/Registration: Register a unique user (under 20 characters)
    await page.getByRole('button', { name: 'Create an account' }).click();

    const uniqueUsername = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    await page.locator('#username').fill(uniqueUsername);
    await page.locator('#password').fill('Password123!');
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

    // Navigate to Timeout & Duration sub-tab
    const timeoutSubTabBtn = page.locator('button.performance-subtab-btn:has-text("Timeout & Duration")');
    await expect(timeoutSubTabBtn).toBeVisible();
    await timeoutSubTabBtn.click();

    const timeoutInput = page.locator('label:has-text("Individual Request Timeout (ms)") + input');
    await expect(timeoutInput).toBeVisible();
    await timeoutInput.fill('2500');

    // Switch back to Concurrency & Rate Limits sub-tab for delay setting
    const concurrencySubTabBtn = page.locator('button.performance-subtab-btn:has-text("Concurrency & Rate Limits")');
    await expect(concurrencySubTabBtn).toBeVisible();
    await concurrencySubTabBtn.click();

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

    // 8. Open Project Settings again and test Dictionaries tab
    await expect(moreSettingsBtn).toBeVisible();
    await moreSettingsBtn.click();

    const dictionariesTabBtn = page.locator('button.tab-bar-btn:has-text("Fuzzing Dictionaries")');
    await expect(dictionariesTabBtn).toBeVisible();
    await dictionariesTabBtn.click();

    // Verify Custom Fuzzing Dictionaries card elements
    await expect(page.locator('text=Custom Fuzzing Dictionaries')).toBeVisible();
    
    // Fill custom dictionaries textarea
    const dictTextarea = page.locator('.dictionary-textarea-container textarea');
    await expect(dictTextarea).toBeVisible();
    await dictTextarea.click();
    await dictTextarea.fill('{"test_user": ["admin", "guest"]}');
    await dictTextarea.blur(); // Trigger blur to save

    // Verify raw config is updated with the custom dictionaries
    const rawConfigTabBtnSecond = page.locator('button.tab-bar-btn:has-text("Raw JSON Config")');
    await expect(rawConfigTabBtnSecond).toBeVisible();
    await rawConfigTabBtnSecond.click();

    const rawTextareaSecond = page.locator('.card:has-text("Raw JSON Configuration") >> textarea.textarea');
    await expect(rawTextareaSecond).toHaveValue(/"test_user"/);
  });

  test('should verify settings have actual effect on fuzzer and cover General, Chaining, and Wordlists tabs', async ({ page }) => {
    // 1. Navigate to the frontend dev server
    await page.goto('/');
    await page.getByRole('button', { name: 'Sign In' }).click();

    // 2. Handle Login/Registration: Register a unique user
    await page.getByRole('button', { name: 'Create an account' }).click();

    const uniqueUsername = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    await page.locator('#username').fill(uniqueUsername);
    await page.locator('#password').fill('Password123!');
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

    const fuzzingTabBtn = page.locator('button.tab-bar-btn:has-text("Fuzzing & Performance")');
    const timeoutInput = page.locator('label:has-text("Individual Request Timeout (ms)") + input');
    const iterationsInput = page.locator('label:has-text("Fuzzing Intensity") + input');
    const rawConfigTabBtnSecond = page.locator('button.tab-bar-btn:has-text("Raw JSON Config")');
    const saveBtn = page.locator('button:has-text("Save Configuration")');
    const successMsg = page.locator('text=/Configuration updated successfully/');
    const backBtn = page.locator('button:has-text("Back to Dashboard")');
    const profilesSection = page.locator('.sidebar-section:has-text("Profiles")');
    const boundaryToggle = profilesSection.locator('.profile-toggle.boundary');
    const maliciousToggle = profilesSection.locator('.profile-toggle.malicious');

    try {
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

      // 8. Now set the timeout to 5ms and iterations to 1 to test settings
      await expect(fuzzingTabBtn).toBeVisible();
      await fuzzingTabBtn.click();

      // Switch to Timeout & Duration sub-tab
      const timeoutSubTabBtn2 = page.locator('button.performance-subtab-btn:has-text("Timeout & Duration")');
      await expect(timeoutSubTabBtn2).toBeVisible();
      await timeoutSubTabBtn2.click();

      await expect(timeoutInput).toBeVisible();
      await timeoutInput.fill('5'); // Set timeout to 5ms so swagger parser doesn't crash

      // Switch to Fuzzing & Intensity sub-tab
      const fuzzingSubTabBtn2 = page.locator('button.performance-subtab-btn:has-text("Fuzzing & Intensity")');
      await expect(fuzzingSubTabBtn2).toBeVisible();
      await fuzzingSubTabBtn2.click();

      await expect(iterationsInput).toBeVisible();
      await iterationsInput.fill('1'); // Set iterations to 1

      // Switch to Raw JSON Config tab to save the configuration
      await expect(rawConfigTabBtnSecond).toBeVisible();
      await rawConfigTabBtnSecond.click();

      // Save configuration
      await expect(saveBtn).toBeVisible();
      await saveBtn.click();
      await expect(successMsg).toBeVisible();

      // 9. Go back to Dashboard and run fuzzer
      await expect(backBtn).toBeVisible();
      await backBtn.click();
      await expect(moreSettingsBtn).toBeVisible();

      // Disable heavy profiles to speed up E2E test (intensity is already 1)

      await expect(boundaryToggle).toHaveClass(/active/);
      await boundaryToggle.click();
      await expect(boundaryToggle).not.toHaveClass(/active/);

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

      // Wait for the fuzzer to complete (timeout of 5ms makes it complete/fail fast)
      await expect(startBtn).toBeVisible({ timeout: 20000 });

      // 10. Verify that the 5ms timeout had an effect by checking that total requests ran but 2xx success count is low
      const totalStat = page.locator('.stat-card.stat-total .stat-value');
      await expect(totalStat).not.toHaveText('0', { timeout: 15000 });

      const successStat = page.locator('.stat-card.stat-2xx .stat-value');
      // Tolerate very low success count (e.g. < 20) on fast machines where loopback is < 5ms
      await expect(async () => {
        const text = await successStat.innerText();
        const val = parseInt(text, 10);
        expect(val).toBeLessThan(20);
      }).toPass({ timeout: 10000 });
    } finally {
      // 11. Cleanup: restore default settings to prevent polluting coordinator database for other tests
      // Check if we are currently on the settings page or dashboard
      if (await moreSettingsBtn.isVisible()) {
        await moreSettingsBtn.click();
      }
      await fuzzingTabBtn.click();
      await page.locator('button.performance-subtab-btn:has-text("Timeout & Duration")').click();
      await timeoutInput.fill('2000');
      await page.locator('button.performance-subtab-btn:has-text("Fuzzing & Intensity")').click();
      await iterationsInput.fill('5');
      await rawConfigTabBtnSecond.click();
      await saveBtn.click();
      await expect(successMsg).toBeVisible();

      // Restore boundary/malicious profiles back to default (Boundary, Malicious active)
      await backBtn.click();
      await expect(moreSettingsBtn).toBeVisible();
      
      const boundaryClass = await boundaryToggle.getAttribute('class');
      if (boundaryClass && !boundaryClass.includes('active')) {
        await boundaryToggle.click();
      }
      const maliciousClass = await maliciousToggle.getAttribute('class');
      if (maliciousClass && !maliciousClass.includes('active')) {
        await maliciousToggle.click();
      }
    }
  });

  test('should support editing raw JSON config with comments (JSONC)', async ({ page }) => {
    // 1. Navigate to frontend
    await page.goto('/');
    await page.getByRole('button', { name: 'Sign In' }).click();

    // 2. Register unique user
    await page.getByRole('button', { name: 'Create an account' }).click();
    const uniqueUsername = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    await page.locator('#username').fill(uniqueUsername);
    await page.locator('#password').fill('Password123!');
    await page.locator('#password').press('Enter');
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });

    // 3. Open Project Settings
    const moreSettingsBtn = page.locator('button:has-text("More Project Settings")');
    await expect(moreSettingsBtn).toBeVisible();
    await moreSettingsBtn.click();

    // 4. Switch to Raw JSON Config tab
    const rawConfigTabBtn = page.locator('button.tab-bar-btn:has-text("Raw JSON Config")');
    await expect(rawConfigTabBtn).toBeVisible();
    await rawConfigTabBtn.click();

    const rawTextarea = page.locator('.card:has-text("Raw JSON Configuration") >> textarea.textarea');
    await expect(rawTextarea).toBeVisible();

    // Wait for the textarea to be populated
    await expect(rawTextarea).toHaveValue(/timeout_ms/);

    // 5. Test invalid JSON format validation (negative scenario)
    await rawTextarea.fill('{ invalid-json-here }');
    const invalidJsonError = page.locator('text=Invalid JSON');
    await expect(invalidJsonError).toBeVisible();

    const saveBtn = page.locator('button:has-text("Save Configuration")');
    await expect(saveBtn).toBeDisabled();

    // 6. Input a JSONC string containing single-line and multi-line comments (positive scenario)
    const jsoncConfig = `{
      // Set fuzzer timeout in ms
      "timeout_ms": 2500,
      /*
        CORS configuration or other settings
      */
      "base_url": "https://jsonc-test-url.com"
    }`;

    // Fill the textarea with comments
    await rawTextarea.fill(jsoncConfig);

    // Verify no validation errors are displayed
    await expect(invalidJsonError).not.toBeVisible();


    // Save configuration
    await expect(saveBtn).toBeVisible();
    await expect(saveBtn).toBeEnabled();
    await saveBtn.click();

    // Verify success indicator
    const successMsg = page.locator('text=/Configuration updated successfully/');
    await expect(successMsg).toBeVisible();

    // 6. Go back to general settings tab and verify comments successfully parsed and base_url is updated
    const generalTabBtn = page.locator('button.tab-bar-btn:has-text("General")');
    await expect(generalTabBtn).toBeVisible();
    await generalTabBtn.click();

    const targetInput = page.locator('label:has-text("Target Base URL") + input');
    await expect(targetInput).toHaveValue('https://jsonc-test-url.com');
  });

  test('should configure AI Remediation settings and select rules', async ({ page }) => {
    // 1. Navigate to frontend
    await page.goto('/');
    await page.getByRole('button', { name: 'Sign In' }).click();

    // 2. Register unique user
    await page.getByRole('button', { name: 'Create an account' }).click();
    const uniqueUsername = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    await page.locator('#username').fill(uniqueUsername);
    await page.locator('#password').fill('Password123!');
    await page.locator('#password').press('Enter');
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });

    // 3. Open Project Settings
    const moreSettingsBtn = page.locator('button:has-text("More Project Settings")');
    await expect(moreSettingsBtn).toBeVisible();
    await moreSettingsBtn.click();

    // 4. Switch to AI Remediation tab
    const aiTabBtn = page.locator('button.tab-bar-btn:has-text("AI Remediation")');
    await expect(aiTabBtn).toBeVisible();
    await aiTabBtn.click();

    // 5. Verify the tool dropdown is present and select "agy"
    const toolSelect = page.locator('.settings-tool-select');
    await expect(toolSelect).toBeVisible();
    await toolSelect.selectOption('agy');

    // 6. Switch to Triage sub-tab and verify CLI command
    await page.locator('button.performance-subtab-btn:has-text("Triage Model")').click();
    const pass1CmdInput = page.locator('input.settings-input-full').first();
    await expect(pass1CmdInput).toHaveValue('agy -m gemini-3.5-flash "{{prompt_file}}"');

    // Switch to Remediation sub-tab and verify CLI command
    await page.locator('button.performance-subtab-btn:has-text("Remediation Model")').click();
    const pass2CmdInput = page.locator('input.settings-input-full').first();
    await expect(pass2CmdInput).toHaveValue('agy -m gemini-3.1-pro "{{prompt_file}}"');

    // 7. Switch to Tech Stacks & Rules sub-tab and open select rules modal
    await page.locator('button.performance-subtab-btn:has-text("Tech Stacks & Auto-Fix Rules")').click();
    const selectRulesBtn = page.locator('button.settings-rules-btn');
    await expect(selectRulesBtn).toBeVisible();
    await selectRulesBtn.click();

    const rulesModal = page.locator('.settings-rules-modal');
    await expect(rulesModal).toBeVisible();

    // Toggle swazz/sensitive-data-leak rule (e.g. which is in AVAILABLE_RULES)
    const ruleCheckbox = page.locator('.settings-rule-label:has-text("swazz/sensitive-data-leak") input[type="checkbox"]');
    await expect(ruleCheckbox).toBeVisible();
    await ruleCheckbox.check();

    // Close modal
    const doneBtn = page.locator('.settings-rules-footer button:has-text("Done")');
    await doneBtn.click();
    await expect(rulesModal).not.toBeVisible();

    // 8. Verify the auto-fix rules textarea now includes "swazz/sensitive-data-leak"
    const autoFixRulesTextarea = page.locator('label:has-text("Rules to Auto-Fix") + textarea');
    await expect(autoFixRulesTextarea).toContainText('swazz/sensitive-data-leak');

    // 9. Switch back to CLI & General Settings sub-tab for checkbox and URL mappings
    await page.locator('button.performance-subtab-btn:has-text("CLI & General Settings")').click();

    const proposeFixesCheckbox = page.locator('label:has-text("Propose Fixes Automatically") >> input[type="checkbox"]');
    await expect(proposeFixesCheckbox).toBeVisible();
    await proposeFixesCheckbox.check();
    await expect(proposeFixesCheckbox).toBeChecked();

    // 10. Fill URL mappings with valid JSON
    const urlMappingsTextarea = page.locator('label:has-text("URL to Repository Mappings") + textarea');
    await urlMappingsTextarea.fill('{"/api/*": "git@github.com:SecH0us3/swazz.git"}');

    // 11. Save AI Settings
    const saveBtn = page.locator('button[type="submit"]:has-text("Save AI Settings")');
    await saveBtn.click();

    // Verify success msg
    const successMsg = page.locator('text=/Saved successfully/');
    await expect(successMsg).toBeVisible();

    // 12. Switch tabs and back to verify persistence
    const generalTabBtn = page.locator('button.tab-bar-btn:has-text("General")');
    await generalTabBtn.click();
    await aiTabBtn.click();

    // Assert states are preserved
    await expect(toolSelect).toHaveValue('agy');
    await page.locator('button.performance-subtab-btn:has-text("Triage Model")').click();
    await expect(pass1CmdInput).toHaveValue('agy -m gemini-3.5-flash "{{prompt_file}}"');
    await page.locator('button.performance-subtab-btn:has-text("CLI & General Settings")').click();
    await expect(proposeFixesCheckbox).toBeChecked();
    await expect(urlMappingsTextarea).toHaveValue('{"/api/*": "git@github.com:SecH0us3/swazz.git"}');
  });

  test('should display Traffic Capture settings tab', async ({ page }) => {
    // 1. Navigate to frontend
    await page.goto('/');

    // 2. Register unique user
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.getByRole('button', { name: 'Create an account' }).click();
    const uniqueUsername = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    await page.locator('#username').fill(uniqueUsername);
    await page.locator('#password').fill('Password123!');
    await page.locator('#password').press('Enter');
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });

    // 3. Open User Settings modal
    const userMenuBtn = page.locator('button.user-menu-btn, .user-avatar, button:has-text("Account")').first();
    await expect(userMenuBtn).toBeVisible();
    await userMenuBtn.click();

    const userSettingsBtn = page.locator('button:has-text("User Settings"), button:has-text("Settings")').first();
    await expect(userSettingsBtn).toBeVisible();
    await userSettingsBtn.click();

    // 4. Switch to Traffic Capture tab in User Settings
    const captureTabBtn = page.locator('.user-settings-nav button:has-text("Traffic Capture"), button.tab-bar-btn:has-text("Traffic Capture")').first();
    await expect(captureTabBtn).toBeVisible();
    await captureTabBtn.click();

    // 5. Verify credentials card details
    const extSyncHeader = page.locator('.traffic-capture-card-title:has-text("Browser Extension Sync")');
    await expect(extSyncHeader).toBeVisible();

    const targetBaseUrlField = page.locator('.traffic-capture-credential-label:has-text("Target Base URL") + .traffic-capture-credential-value-row .traffic-capture-credential-value');
    await expect(targetBaseUrlField).toBeVisible();

    // 6. Verify setup steps guide card
    const setupHeader = page.locator('.traffic-capture-card-title:has-text("Setup & Installation")');
    await expect(setupHeader).toBeVisible();
    
    const firstStepContent = page.locator('.traffic-capture-step:has-text("Load unpacked extension")');
    await expect(firstStepContent).toBeVisible();
  });
});

