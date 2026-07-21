import { test, expect } from '@playwright/test';

test.describe('Payload Settings Modal Interaction', () => {
  test('should navigate tabs and toggle payload categories', async ({ page }) => {
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

    // 3. Open the "Payload Settings" modal via the Customize Payloads button
    const customizePayloadsBtn = page.getByRole('button', { name: 'Customize Payloads' });
    await expect(customizePayloadsBtn).toBeVisible();
    await customizePayloadsBtn.click();

    // Verify the modal appears and waits for the API to load payload categories
    const modalTitle = page.getByRole('heading', { name: 'Payload Settings' });
    await expect(modalTitle).toBeVisible();

    // Wait for the catalog grid to load
    const catalogGrid = page.locator('.catalog-grid');
    await expect(catalogGrid).toBeVisible({ timeout: 10000 });

    // 4. Verify the tab navigation ('Random', 'Boundary', 'Malicious')
    const randomTab = page.locator('button.tab-button:has-text("Random")');
    const boundaryTab = page.locator('button.tab-button:has-text("Boundary")');
    const maliciousTab = page.locator('button.tab-button:has-text("Malicious")');

    await expect(randomTab).toBeVisible();
    await expect(boundaryTab).toBeVisible();
    await expect(maliciousTab).toBeVisible();

    // 5. Toggling Logic Verification
    // Switch to the 'Boundary' profile
    await boundaryTab.click();

    // Ensure the Boundary tab is active
    await expect(boundaryTab).toHaveClass(/active/);

    // Toggle one of the catalog items (e.g., enable/disable a specific payload category checkbox)
    const firstCatalogItem = page.locator('.catalog-item').first();
    const checkbox = firstCatalogItem.locator('input[type="checkbox"]');

    // Wait for the first item to be visible
    await expect(firstCatalogItem).toBeVisible();

    // Assuming default is active (checked)
    const wasChecked = await checkbox.isChecked();

    // Click to toggle
    await firstCatalogItem.click();

    // Ensure the checkbox reflects the updated active state
    if (wasChecked) {
      await expect(checkbox).not.toBeChecked();
    } else {
      await expect(checkbox).toBeChecked();
    }
  });
});
