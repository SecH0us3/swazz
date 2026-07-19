import { test, expect } from '@playwright/test';

test.describe('Config Sidebar Contextual Toggle E2E Tests', () => {
  test('should toggle the configuration sidebar using the control bar gear and sidebar close button', async ({ page }) => {
    page.on('console', msg => console.log(`BROWSER CONSOLE [${msg.type()}]: ${msg.text()}`));
    page.on('pageerror', exception => console.log(`BROWSER EXCEPTION: ${exception}`));

    // 1. Navigate to dashboard and log in as guest
    await page.goto('/');
    await page.getByRole('button', { name: 'Sign In' }).click();

    const guestBtn = page.getByRole('button', { name: 'Try as guest →' });
    await expect(guestBtn).toBeVisible();
    await guestBtn.click();

    // 2. Wait for main layout
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });

    const sidebar = page.locator('.config-sidebar');
    const closeBtn = page.locator('.config-sidebar-close');

    // If the sidebar is currently visible, click the close button inside the sidebar to hide it
    if (await closeBtn.isVisible()) {
      await closeBtn.click();
    }

    // Now, verify the sidebar is hidden (has class hidden-desktop)
    await expect(sidebar).toHaveClass(/hidden-desktop/);

    // Verify the settings gear button is visible in the fuzzer control bar
    const gearBtn = page.locator('.btn-config-gear');
    await expect(gearBtn).toBeVisible();

    // 4. Click the gear button to open the configuration sidebar
    await gearBtn.click();

    // Verify the configuration sidebar is now visible (does not have hidden-desktop class)
    await expect(sidebar).not.toHaveClass(/hidden-desktop/);

    // Verify the gear button in the control bar is hidden
    await expect(gearBtn).not.toBeVisible();

    // Verify the close button is visible inside the sidebar
    await expect(closeBtn).toBeVisible();

    // 5. Click the close button inside the sidebar
    await closeBtn.click();

    // Verify the sidebar is hidden again
    await expect(sidebar).toHaveClass(/hidden-desktop/);

    // Verify the gear button is visible again
    await expect(gearBtn).toBeVisible();
  });
});
