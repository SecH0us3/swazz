import { test, expect } from '@playwright/test';

test.describe('Project and Payload Settings E2E Tests', () => {
  test('should configure project settings, verify raw config, and toggle payload settings', async ({ page }) => {
    // 1. Navigate to the frontend dev server
    await page.goto('/');

    // 2. Handle Login/Registration: Register a unique user (under 20 characters)
    const signUpLink = page.locator('button.link-btn:has-text("Sign up")');
    if (await signUpLink.isVisible()) {
      await signUpLink.click();
    }

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

    // Verify the inputs were serialized in JSON config correctly
    const rawConfigValue = await rawTextarea.inputValue();
    const parsedConfig = JSON.parse(rawConfigValue);
    expect(parsedConfig.settings.timeout_ms).toBe(2500);
    expect(parsedConfig.settings.delay_between_requests_ms).toBe(100);
    expect(parsedConfig.settings.bola_testing).toBe(true);
    expect(parsedConfig.security.allow_private_ips).toBe(true);

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
});
