import { test, expect } from '@playwright/test';

test.describe('Login UX and Combined Actions E2E Tests', () => {
  test('should allow direct registration via Create, show tip on invalid credentials, and handle layout properly', async ({ page }) => {
    // Enable diagnostics logging
    page.on('console', msg => console.log(`BROWSER CONSOLE [${msg.type()}]: ${msg.text()}`));
    page.on('pageerror', exception => console.log(`BROWSER EXCEPTION: ${exception}`));

    // 1. Navigate to the frontend
    await page.goto('/');
    await page.getByRole('button', { name: 'Sign In' }).click();

    const createAccountBtn = page.getByRole('button', { name: 'Create an account' });
    const enterWorkspaceBtn = page.getByRole('button', { name: 'Log In' });
    await expect(createAccountBtn).toBeVisible();
    await expect(enterWorkspaceBtn).toBeVisible();

    // 2. Perform direct registration
    const uniqueUsername = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    await page.locator('#username').fill(uniqueUsername);
    await page.locator('#password').fill('Password123!');

    // Register by clicking Create
    const configPromise = page.waitForResponse(resp => resp.url().includes('/config') && resp.status() === 200);
    await createAccountBtn.click();

    // Wait for main dashboard to load
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });
    await configPromise;

    // 3. Log out via User Menu dropdown
    const accountBtn = page.locator('button[title="Account"]');
    await expect(accountBtn).toBeVisible();
    await accountBtn.click();

    const logoutBtn = page.locator('button:has-text("Logout")');
    await expect(logoutBtn).toBeVisible();
    await logoutBtn.click();

    // Verify back on login screen
    await expect(createAccountBtn).toBeVisible();

    // 4. Fill in same username but invalid password to test "Invalid credentials" error & tip
    await page.locator('#username').fill(uniqueUsername);
    await page.locator('#password').fill('wrongpassword');
    await enterWorkspaceBtn.click();

    // Verify error and tip are shown
    const errorEl = page.locator('.login-error');
    await expect(errorEl).toBeVisible();
    await expect(errorEl).toContainText('Invalid credentials');
    
    const tipEl = page.locator('.login-error-tip');
    await expect(tipEl).toBeVisible();
    await expect(tipEl).toContainText('New user? Click Create to sign up.');
  });
});
