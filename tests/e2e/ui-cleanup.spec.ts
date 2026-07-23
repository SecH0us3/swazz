import { test, expect } from '@playwright/test';

test.describe('UI/UX Right Column Cleanup Verification', () => {
  test('Verify streamlined ConfigSidebar and moved controls', async ({ page }) => {
    // 1. Register and sign in a new user
    await page.goto('/');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.getByRole('button', { name: 'Create an account' }).click();

    const uniqueUsername = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    await page.locator('#username').fill(uniqueUsername);
    await page.locator('#password').fill('Password123!');
    await page.locator('#password').press('Enter');

    // Wait for the main layout to load
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });

    // 2. Verify ConfigSidebar right column exists and is streamlined
    const sidebar = page.locator('.config-sidebar');
    await expect(sidebar).toBeVisible();

    // ConfigSidebar should contain Profiles, Headers, Cookies, and Config sections
    await expect(sidebar.locator('text=Profiles')).toBeVisible();
    await expect(sidebar.locator('text=Headers (User A / Primary Session)')).toBeVisible();
    await expect(sidebar.locator('text=Cookies (User A / Primary Session)')).toBeVisible();
    await expect(sidebar.locator('text=BOLA / Multi-Identity')).toBeVisible();

    // ConfigSidebar must NOT contain old redundant/moved sections
    await expect(sidebar.locator('text=Config')).not.toBeVisible();
    await expect(sidebar.locator('text=Import Config')).not.toBeVisible();
    await expect(sidebar.locator('text=Export Config')).not.toBeVisible();
    await expect(sidebar.locator('text=Intensity')).not.toBeVisible();
    await expect(sidebar.locator('text=Dictionaries')).not.toBeVisible();
    await expect(sidebar.locator('text=Concurrency')).not.toBeVisible();
    await expect(sidebar.locator('text=Timeout (ms)')).not.toBeVisible();

    // Toggle BOLA in sidebar
    const bolaCheckboxSidebar = sidebar.locator('label:has-text("Enable BOLA Checking") >> input[type="checkbox"]');
    await expect(bolaCheckboxSidebar).toBeVisible();
    await bolaCheckboxSidebar.check();
    await expect(bolaCheckboxSidebar).toBeChecked();
    await expect(sidebar.locator('text=User B (Secondary)')).toBeVisible();

    // 3. Navigate to More Project Settings
    const moreSettingsBtn = page.locator('button:has-text("More Project Settings")');
    await expect(moreSettingsBtn).toBeVisible();
    await moreSettingsBtn.click();

    const settingsHeader = page.locator('h1:has-text("Project Settings")');
    await expect(settingsHeader).toBeVisible();

    // 4. Verify "Fuzzing & Performance" tab has the moved settings
    const performanceTabBtn = page.locator('button.tab-bar-btn:has-text("Fuzzing & Performance")');
    await expect(performanceTabBtn).toBeVisible();
    await performanceTabBtn.click();

    await expect(page.locator('label:has-text("Request Concurrency")')).toBeVisible();
    await expect(page.locator('label:has-text("Enable Rate Limit Detection")')).toBeVisible();

    // Switch to Fuzzing & Intensity sub-tab for intensity & domain filter settings
    const fuzzingSubTabBtn = page.locator('button.performance-subtab-btn:has-text("Fuzzing & Intensity")');
    await expect(fuzzingSubTabBtn).toBeVisible();
    await fuzzingSubTabBtn.click();

    await expect(page.locator('label:has-text("Fuzzing Intensity (Iterations per profile)")')).toBeVisible();
    await expect(page.locator('label:has-text("HAR Domain Filter")')).toBeVisible();

    // 5. Verify "Anomalies & Security" tab has the BOLA identity config
    const anomaliesTabBtn = page.locator('button.tab-bar-btn:has-text("Anomalies & Security")');
    await expect(anomaliesTabBtn).toBeVisible();
    await anomaliesTabBtn.click();

    const bolaCheckbox = page.locator('label:has-text("Enable Broken Object Level Authorization (BOLA) checking") >> input[type="checkbox"]');
    await expect(bolaCheckbox).toBeVisible();

    await bolaCheckbox.check();
    await expect(bolaCheckbox).toBeChecked();

    // User B identity card should appear now in settings content
    await expect(page.locator('.project-settings-content').locator('text=User B (Secondary)')).toBeVisible();
    await expect(page.locator('.project-settings-content').locator('text=Headers (User B)')).toBeVisible();

    // 6. Verify "Fuzzing Dictionaries" tab has Custom Fuzzing Dictionaries JSON and help text
    const dictionariesTabBtn = page.locator('button.tab-bar-btn:has-text("Fuzzing Dictionaries")');
    await expect(dictionariesTabBtn).toBeVisible();
    await dictionariesTabBtn.click();

    await expect(page.locator('text=Custom Fuzzing Dictionaries')).toBeVisible();
    await expect(page.locator('text=How Dictionaries Work')).toBeVisible();
    await expect(page.locator('textarea[placeholder*="email"]')).toBeVisible();

    // 7. Verify "Raw JSON Config" tab has Import/Export buttons
    const rawConfigTabBtn = page.locator('button.tab-bar-btn:has-text("Raw JSON Config")');
    await expect(rawConfigTabBtn).toBeVisible();
    await rawConfigTabBtn.click();

    await expect(page.locator('button:has-text("Import File")')).toBeVisible();
    await expect(page.locator('button:has-text("Export File")')).toBeVisible();
  });
});

