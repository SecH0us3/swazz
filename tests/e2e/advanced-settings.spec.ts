import { test, expect } from '@playwright/test';

test.describe('Advanced Project Settings and Keyboard Shortcuts E2E Tests', () => {
  // Helper to register and log in before each test case
  test.beforeEach(async ({ page }) => {
    page.on("console", msg => console.log(`BROWSER CONSOLE [${msg.type()}]: ${msg.text()}`));
    page.on("pageerror", exception => console.log(`BROWSER EXCEPTION: ${exception}`));
    page.on("requestfailed", req => console.log(`BROWSER REQUEST FAILED: ${req.url()} - ${req.failure()?.errorText}`));

    await page.goto('/');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.getByRole('button', { name: 'Create an account' }).click();

    // Use a unique username complying with length constraints (3 to 20 chars)
    const uniqueUsername = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    await page.locator('#username').fill(uniqueUsername);
    await page.locator('#password').fill('Password123!');
    await page.locator('#password').press('Enter');

    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });
  });

  test('should configure anomalies, validate invalid ignore status codes, and update ignore rules', async ({ page }) => {
    // Navigate to Project Settings page
    const moreSettingsBtn = page.locator('button:has-text("More Project Settings")');
    await expect(moreSettingsBtn).toBeVisible();
    await moreSettingsBtn.click();

    await expect(page.locator('h1:has-text("Project Settings")')).toBeVisible();

    // 1. Click Anomalies & Security tab
    const anomaliesTabBtn = page.locator('button.tab-bar-btn:has-text("Anomalies & Security")');
    await expect(anomaliesTabBtn).toBeVisible();
    await anomaliesTabBtn.click();

    // 2. Validate toggling Response Body Structural Analysis checkbox
    const deviationMultiplierInput = page.locator('label:has-text("Size Anomaly Deviation Multiplier") + input');
    await expect(deviationMultiplierInput).toBeVisible();

    const responseBodyCheckbox = page.locator('label:has-text("Enable Response Body Structural Analysis") >> input[type="checkbox"]');
    await expect(responseBodyCheckbox).toBeVisible();
    await expect(responseBodyCheckbox).toBeChecked();

    // Uncheck and verify hidden deviation multiplier input
    await responseBodyCheckbox.uncheck();
    await expect(responseBodyCheckbox).not.toBeChecked();
    await expect(deviationMultiplierInput).toBeHidden();

    // Check it back on and verify it appears again
    await responseBodyCheckbox.check();
    await expect(responseBodyCheckbox).toBeChecked();
    await expect(deviationMultiplierInput).toBeVisible();

    // 3. Test negative validation alerts for Ignored HTTP Status Codes
    const addCodeInput = page.locator('input[placeholder="e.g. 404"]');
    const addCodeBtn = page.locator('button:has-text("Add Code")');
    await expect(addCodeInput).toBeVisible();
    await expect(addCodeBtn).toBeVisible();

    // Alert check helper for "abc"
    let alertMessage = '';
    page.once('dialog', async dialog => {
      alertMessage = dialog.message();
      await dialog.accept();
    });
    await addCodeInput.fill('abc');
    await addCodeBtn.click();
    // Verify alert message triggered
    expect(alertMessage).toContain('valid 3-digit HTTP status code');

    // Alert check helper for "99"
    page.once('dialog', async dialog => {
      alertMessage = dialog.message();
      await dialog.accept();
    });
    await addCodeInput.fill('99');
    await addCodeBtn.click();
    expect(alertMessage).toContain('valid 3-digit HTTP status code');

    // Alert check helper for "600"
    page.once('dialog', async dialog => {
      alertMessage = dialog.message();
      await dialog.accept();
    });
    await addCodeInput.fill('600');
    await addCodeBtn.click();
    expect(alertMessage).toContain('valid HTTP status code');

    // 4. Add valid ignored HTTP status code
    await addCodeInput.fill('418');
    await addCodeBtn.click();

    // Verify tag is visible
    const ignoredCodeTag = page.locator('.tag-btn:has-text("418")');
    await expect(ignoredCodeTag).toBeVisible();

    // 5. Verify in Raw JSON Config
    const rawConfigTabBtn = page.locator('button.tab-bar-btn:has-text("Raw JSON Config")');
    await expect(rawConfigTabBtn).toBeVisible();
    await rawConfigTabBtn.click();

    const rawTextarea = page.locator('.card:has-text("Raw JSON Configuration") >> textarea.textarea');
    await expect(rawTextarea).toBeVisible();
    await expect(rawTextarea).toHaveValue(/418/);

    await expect.poll(async () => {
      try {
        return JSON.parse(await rawTextarea.inputValue());
      } catch {
        return null;
      }
    }).toMatchObject({
      rules: {
        ignore: [418]
      }
    });

    // 6. Delete tag and verify removed
    await anomaliesTabBtn.click();
    await expect(ignoredCodeTag).toBeVisible();

    const deleteTagBtn = ignoredCodeTag.locator('button');
    await expect(deleteTagBtn).toBeVisible();
    await deleteTagBtn.click();

    await expect(ignoredCodeTag).toBeHidden();

    // Verify removed in Raw JSON Config
    await rawConfigTabBtn.click();
    await expect(rawTextarea).toBeVisible();
    await expect.poll(async () => {
      try {
        return JSON.parse(await rawTextarea.inputValue());
      } catch {
        return null;
      }
    }).toMatchObject({
      rules: {
        ignore: []
      }
    });
  });

  test('should add, configure, and verify request chaining rules', async ({ page }) => {
    // Navigate to Project Settings page
    const moreSettingsBtn = page.locator('button:has-text("More Project Settings")');
    await expect(moreSettingsBtn).toBeVisible();
    await moreSettingsBtn.click();

    await expect(page.locator('h1:has-text("Project Settings")')).toBeVisible();

    // 1. Click Request Chaining tab
    const chainingTabBtn = page.locator('button.tab-bar-btn:has-text("Request Chaining")');
    await expect(chainingTabBtn).toBeVisible();
    await chainingTabBtn.click();

    // 2. Add dynamic chaining rule
    const ruleAddBtn = page.locator('button.chaining-rule-add-btn');
    await expect(ruleAddBtn).toBeVisible();
    await ruleAddBtn.click();

    const ruleCard = page.locator('.chaining-rule-card').first();
    await expect(ruleCard).toBeVisible();

    const sourceInput = ruleCard.locator('label:has-text("Source Endpoint") + input');
    await sourceInput.fill('POST /api/login');

    const selectType = ruleCard.locator('label:has-text("Extract Type") + select');
    await selectType.selectOption('header');

    const varInput = ruleCard.locator('label:has-text("Variable Name") + input');
    await varInput.fill('JWT_TOKEN');

    const pathInput = ruleCard.locator('label:has-text("Extract Path / Regex") + input');
    await pathInput.fill('Authorization');

    // 3. Verify serialization in Raw JSON Config
    const rawConfigTabBtn = page.locator('button.tab-bar-btn:has-text("Raw JSON Config")');
    await expect(rawConfigTabBtn).toBeVisible();
    await rawConfigTabBtn.click();

    const rawTextarea = page.locator('.card:has-text("Raw JSON Configuration") >> textarea.textarea');
    await expect(rawTextarea).toBeVisible();
    await expect(rawTextarea).toHaveValue(/JWT_TOKEN/);

    await expect.poll(async () => {
      try {
        return JSON.parse(await rawTextarea.inputValue());
      } catch {
        return null;
      }
    }).toMatchObject({
      settings: {
        chaining_rules: [
          {
            source_endpoint: 'POST /api/login',
            extract_type: 'header',
            extract_path: 'Authorization',
            variable_name: 'JWT_TOKEN'
          }
        ]
      }
    });

    // 4. Delete rule and verify removed
    await chainingTabBtn.click();
    const deleteRuleBtn = ruleCard.locator('button.chaining-rule-delete-btn');
    await expect(deleteRuleBtn).toBeVisible();
    await deleteRuleBtn.click();

    await expect(ruleCard).toBeHidden();

    // Verify deleted in raw JSON
    await rawConfigTabBtn.click();
    await expect.poll(async () => {
      try {
        return JSON.parse(await rawTextarea.inputValue());
      } catch {
        return null;
      }
    }).toMatchObject({
      settings: {
        chaining_rules: []
      }
    });
  });

  test('should validate numeric shortcuts are disabled when focused in inputs', async ({ page }) => {
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

    // Focus on the endpoints search input field
    const searchEndpointsInput = page.locator('input[placeholder="Search endpoints..."]');
    await expect(searchEndpointsInput).toBeVisible();
    await searchEndpointsInput.focus();

    // 1. Try pressing tab shortcut key "2" while focused in search input
    await page.keyboard.press('2');
    
    // Check that we are STILL on tab 1 (Endpoint Heatmap active, Request Logs not active)
    await expect(page.locator('button.tab-bar-btn.active:has-text("Endpoint Heatmap")')).toBeVisible();
    await expect(page.locator('button.tab-bar-btn.active:has-text("Request Logs")')).toBeHidden();

    // Verify the character '2' was typed into the input field instead of triggering shortcut
    await expect(searchEndpointsInput).toHaveValue('2');

    // 2. Blur input and try shortcut again
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur());
    await page.locator('.app-layout').click();

    await page.keyboard.press('2');
    await expect(page.locator('button.tab-bar-btn.active:has-text("Request Logs")')).toBeVisible();
  });
});
