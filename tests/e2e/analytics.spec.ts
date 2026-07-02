import { test, expect } from '@playwright/test';

test.describe('Analytics Dashboard E2E Tests', () => {
  test('should navigate to Analytics tab and render charts', async ({ page }) => {
    // Listen for console errors or logs
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.error('PAGE ERROR:', err.message));

    // Intercept analytics API
    await page.route('**/api/projects/*/analytics', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          scanStats: { total: 42, completed: 35, failed: 7, avgDuration: 120 },
          scanHistory: [
            { date: '2026-07-01', count: 3, completed_count: 2, failed_count: 1 }
          ],
          findingsStats: [
            { severity: 'error', category: 'swazz/reflected-xss', count: 5 },
            { severity: 'warning', category: 'swazz/bola-idor', count: 3 }
          ],
          findingsHistory: [
            { date: '2026-07-01', severity: 'error', count: 5 }
          ],
          runnerMetrics: {
            totalConnected: 4,
            totalBusy: 2,
            utilization: 50.0,
            runners: [
              { name: 'Runner-1', isShared: false, isBusy: true },
              { name: 'Runner-2', isShared: true, isBusy: false }
            ]
          }
        })
      });
    });

    // 1. Navigate to home
    await page.goto('/');

    // 2. Register unique user
    const createBtn = page.getByRole('button', { name: 'Create' });
    await expect(createBtn).toBeVisible();
    await createBtn.click();

    // Username matching length requirement of 3 to 20 characters
    const uniqueUsername = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    await page.locator('#username').fill(uniqueUsername);
    await page.locator('#password').fill('Password123!');
    await page.locator('#password').press('Enter');

    // Wait for app layout to mount
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });

    // 3. Try Petstore Demo to show active workspace
    const demoBtn = page.getByRole('button', { name: /Try Petstore Demo/ });
    await expect(demoBtn).toBeVisible();
    await demoBtn.click();

    // Wait for endpoints tree structure to render so sidebar has loaded the workspace fully
    await expect(page.locator('.tree-leaf-row').first()).toBeVisible({ timeout: 15000 });

    // 4. Locate and click Analytics tab with retries to handle React binding delays
    const analyticsTab = page.locator('button.tab-bar-btn:has-text("Analytics")');
    await expect(analyticsTab).toBeVisible({ timeout: 15000 });
    
    // Perform click and wait for active state
    await page.waitForTimeout(1000); // Wait for React handlers to stabilize
    await analyticsTab.click();

    // Check if the tab button has active class, if not click again
    const isActive = await analyticsTab.evaluate(el => el.classList.contains('active'));
    if (!isActive) {
      console.log('Tab did not become active, retrying click...');
      await page.waitForTimeout(500);
      await analyticsTab.click();
    }

    // 5. Verify stats and dashboard content are visible
    await expect(page.locator('text=Total Scans')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.kpi-value:has-text("42")')).toBeVisible();
    await expect(page.locator('.kpi-value:has-text("50.0%")')).toBeVisible();

    // Verify SVG charts exist
    const svgCharts = page.locator('svg.svg-chart');
    await expect(svgCharts.first()).toBeVisible();
  });
});
