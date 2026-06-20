import { test, expect } from '@playwright/test';

test.describe('Input Validation & Error Handling (Broken Specs) E2E Test', () => {
  test('should display validation error toast when adding an invalid or nonexistent Swagger spec URL', async ({ page }) => {
    // 1. Navigate to the frontend dev server
    await page.goto('/');

    // 2. Handle Login/Registration: Register a unique user
    const signUpLink = page.locator('button.link-btn:has-text("Sign up")');
    if (await signUpLink.isVisible()) {
      await signUpLink.click();
    }

    const uniqueUsername = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    await page.locator('#username').fill(uniqueUsername);
    await page.locator('#password').fill('password123');

    const configPromise = page.waitForResponse(resp => resp.url().includes('/config') && resp.status() === 200);
    await page.locator('#password').press('Enter');

    // Wait for the main layout to load
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });
    await configPromise;

    // 3. Find the spec URL input and fill it with a malformed/nonexistent spec URL
    const specUrlInput = page.locator('input[placeholder="https://api.com/swagger.json or /graphql"]');
    await expect(specUrlInput).toBeVisible();
    
    const invalidUrl = 'http://127.0.0.1:8788/nonexistent-invalid-route-500.json';
    await specUrlInput.fill(invalidUrl);

    // 4. Click the "Add" button
    const addBtn = page.locator('button.btn-primary:has-text("Add")');
    await expect(addBtn).toBeVisible();
    await addBtn.click();

    // 5. Verify that a friendly validation error toast is displayed and the page does not crash
    const toast = page.locator('.toast', { hasText: 'Failed' });
    await expect(toast).toBeVisible({ timeout: 10000 });
  });
});
