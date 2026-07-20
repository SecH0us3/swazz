import { test, expect } from '@playwright/test';

test.describe('Landing Page', () => {
  test('should display the global scan count', async ({ page }) => {
    // Mock the /api/telemetry/scans/count endpoint
    await page.route('/api/telemetry/scans/count', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ total: 8765432 }),
      });
    });

    // Navigate to the landing page
    await page.goto('/');

    // Wait for the formatted number to become visible on the page
    // Using a slightly longer timeout in case of counting animation (takes ~2s)
    await expect(page.getByText('8,765,432+ Scans')).toBeVisible({ timeout: 15000 });
  });
});
