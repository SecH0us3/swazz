import { test, expect } from '@playwright/test';

test.describe('Closed Beta Launch & Capacity Control E2E Tests', () => {
  test('should display beta slots banner and handle regular registration when under limit', async ({ page }) => {
    await page.goto('/?no_bypass_e2e_gate=true');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.getByRole('button', { name: "Create" }).click();

    // Verify slots banner is visible
    const banner = page.locator('.beta-status-banner');
    await expect(banner).toBeVisible();
    await expect(banner).toContainText('Closed Beta · Limited availability');

    // Verify invite code toggle button is visible and click it
    const toggleBtn = page.locator('.invite-code-toggle-btn');
    await expect(toggleBtn).toBeVisible();
    await toggleBtn.click();

    // Verify invite code field is rendered but not marked as required
    const inviteInput = page.locator('#inviteCode');
    await expect(inviteInput).toBeVisible();
    await expect(inviteInput).not.toHaveAttribute('required', '');

    // Register a new user successfully without an invite code (keep username under 20 chars)
    const uniqueUsername = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 100)}`;
    await page.locator('#username').fill(uniqueUsername);
    await page.locator('#password').fill('Password123!');
    await page.locator('button.login-btn').click();

    // Wait for the main layout to load
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });

    // Handle ProjectKeyInitializer screen (new user always sees this)
    const generateKeysBtn = page.getByRole('button', { name: 'Generate Keys' });
    await expect(generateKeysBtn).toBeVisible({ timeout: 10000 });
    await generateKeysBtn.click();
    await page.getByRole('button', { name: 'Continue to Workspace' }).click();

    // Verify logged-in dashboard shows the beta status alert banner
    await expect(page.locator('.beta-status-alert')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.beta-status-alert')).toContainText('Closed Beta Phase:');
  });

  test('should require invite code and enforce limits when beta limit is reached', async ({ page }) => {
    await page.route('**/api/info', async route => {
      const response = await route.fetch();
      const headers = response.headers();
      const json = await response.json();
      json.beta_mode_enabled = true;
      json.beta_limit_reached = true;
      await route.fulfill({
        response,
        headers,
        json
      });
    });

    // Mock /api/auth/register to simulate beta limit reached error
    await page.route('**/api/auth/register', async route => {
      const request = route.request();
      if (request.method() === 'POST') {
        const body = request.postDataJSON() || {};
        if (body.inviteCode !== 'SWAZZ_BETA_2026') {
          await route.fulfill({
            status: 403,
            contentType: 'application/json',
            json: { error: 'Beta registration limit reached. Please provide a valid invite code to signup.' }
          });
          return;
        }
      }
      await route.continue();
    });

    await page.goto('/?no_bypass_e2e_gate=true');
    await page.getByRole('button', { name: 'Sign In' }).click();
    await page.getByRole('button', { name: "Create" }).click();

    await expect(page.locator('.beta-status-banner.filled')).toBeVisible();
    await expect(page.locator('.beta-status-banner.filled')).toContainText('Closed Beta · Invite code required');

    // Verify invite code field is marked as required
    const inviteInput = page.locator('#inviteCode');
    await expect(inviteInput).toBeVisible();
    await expect(inviteInput).toHaveAttribute('required', '');

    // Attempt registration with invalid invite code
    const uniqueUsername = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 100)}`;
    await page.locator('#username').fill(uniqueUsername);
    await page.locator('#password').fill('Password123!');
    await inviteInput.fill('INVALID_CODE');
    await page.locator('button.login-btn').click();

    // Verify registration error is shown
    await expect(page.locator('.login-error')).toBeVisible();
    await expect(page.locator('.login-error')).toContainText('Beta registration limit reached');

    // Correct bypass code should succeed
    await inviteInput.fill('SWAZZ_BETA_2026');
    await page.locator('button.login-btn').click();

    // Wait for layout to load successfully
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });
  });
});
