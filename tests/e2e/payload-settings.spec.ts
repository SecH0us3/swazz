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
    
    // Wait for the API response while clicking
    const responsePromise = page.waitForResponse(response => response.url().includes('/api/payload-catalog'));
    await customizePayloadsBtn.click();
    await responsePromise;

    // Verify the modal appears and waits for the API to load payload categories
    const modalTitle = page.getByRole('heading', { name: 'Payload Settings' });
    await expect(modalTitle).toBeVisible();

    // Wait for the catalog grid to load
    const catalogGrid = page.locator('.catalog-grid');
    await expect(catalogGrid).toBeVisible({ timeout: 10000 });

    // 4. Verify the tab navigation ('Random', 'Boundary', 'Malicious')
    const randomTab = page.getByRole('button', { name: 'Random', exact: true });
    const boundaryTab = page.getByRole('button', { name: 'Boundary', exact: true });
    const maliciousTab = page.getByRole('button', { name: 'Malicious', exact: true });

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

    // Ensure the checkbox is checked by default
    await expect(checkbox).toBeChecked();

    // Click to toggle and wait for backend persistence (e.g., config update)
    const updatePromise = page.waitForResponse(response => 
      response.url().includes('/api/') && response.request().method() !== 'GET' && response.status() >= 200 && response.status() < 300
    );
    await firstCatalogItem.click();
    await updatePromise;

    // Ensure the checkbox is now unchecked
    await expect(checkbox).not.toBeChecked();
  });
});
