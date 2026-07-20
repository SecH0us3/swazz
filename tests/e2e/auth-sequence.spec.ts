import { test, expect } from '@playwright/test';

test.describe('Auth Sequence E2E Tests', () => {
  test('should configure Auth Sequence with a TOTP step', async ({ page }) => {
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

    // 4. Modify Auth Sequence settings
    const authSequenceTabBtn = page.locator('button.tab-bar-btn:has-text("Auth Sequence")');
    await expect(authSequenceTabBtn).toBeVisible();
    await authSequenceTabBtn.click();

    const addStepBtn = page.locator('button:has-text("+ Add Step")');
    await expect(addStepBtn).toBeVisible();
    await addStepBtn.click();

    const stepCard = page.locator('.chaining-rule-card').last();

    // Select TOTP type
    const stepTypeSelect = stepCard.locator('select').first();
    await stepTypeSelect.selectOption('totp');

    // Fill in TOTP details
    const totpSecretInput = stepCard.locator('input[placeholder="JBSWY3DPEHPK3PXP"]');
    await expect(totpSecretInput).toBeVisible();
    await totpSecretInput.fill('JBSWY3DPEHPK3PXP');

    const totpVarInput = stepCard.locator('input[placeholder="totp_code"]');
    await expect(totpVarInput).toBeVisible();
    await totpVarInput.fill('totp_code');

    // 5. Verify in Raw JSON Config
    const rawConfigTabBtn = page.locator('button.tab-bar-btn:has-text("Raw JSON Config")');
    await expect(rawConfigTabBtn).toBeVisible();
    await rawConfigTabBtn.click();

    const rawTextarea = page.locator('.card:has-text("Raw JSON Configuration") >> textarea.textarea');
    await expect(rawTextarea).toBeVisible();

    await expect.poll(async () => {
      try {
        return JSON.parse(await rawTextarea.inputValue());
      } catch {
        return null;
      }
    }).toMatchObject({
      auth_sequence: [
        {
          type: 'totp',
          totp_secret: 'JBSWY3DPEHPK3PXP',
          totp_variable: 'totp_code',
        }
      ]
    });
  });
});
