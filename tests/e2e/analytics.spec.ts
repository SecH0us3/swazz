import { test, expect } from '@playwright/test';

test.describe('Analytics Dashboard E2E Tests', () => {
  test('should navigate to Analytics tab and render charts', async ({ page }) => {
    // Listen for console errors or logs
    page.on('console', msg => console.log('PAGE LOG:', msg.text()));
    page.on('pageerror', err => console.error('PAGE ERROR:', err.message));

    // Intercept analytics API
    await page.route('**/api/projects/*/analytics*', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          scanStats: { total: 42, completed: 35, failed: 7, avgDuration: 120 },
          scanHistory: [
            { date: '2026-07-01', count: 3, completed_count: 2, failed_count: 1 },
            { date: '2026-07-02', count: 5, completed_count: 4, failed_count: 1 }
          ],
          findingsStats: [
            { severity: 'error', category: 'swazz/reflected-xss', count: 5 },
            { severity: 'warning', category: 'swazz/bola-idor', count: 3 }
          ],
          findingsHistory: [
            { date: '2026-07-01', severity: 'error', count: 5 },
            { date: '2026-07-02', severity: 'warning', count: 3 }
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
    await page.getByRole('button', { name: 'Sign In' }).click();

    // 2. Register unique user
    const createBtn = page.getByRole('button', { name: 'Create an account' });
    await expect(createBtn).toBeVisible();
    await createBtn.click();

    // Username matching length requirement of 3 to 20 characters
    const uniqueUsername = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    await page.locator('#username').fill(uniqueUsername);
    await page.locator('#password').fill('Password123!');
    await page.locator('#password').press('Enter');

    // Wait for app layout to mount
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });

    // 3. Try Vulnerable Demo to show active workspace
    const demoBtn = page.getByRole('button', { name: /Try Vulnerable Demo/ });
    await expect(demoBtn).toBeVisible();
    await demoBtn.click();

    // Wait for endpoints tree structure to render so sidebar has loaded the workspace fully
    await expect(page.locator('.tree-leaf-row').first()).toBeVisible({ timeout: 15000 });

    // 4. Locate and click Analytics tab
    const analyticsTab = page.locator('button.tab-bar-btn:has-text("Analytics")');
    await expect(analyticsTab).toBeVisible({ timeout: 15000 });
    
    // Perform click with toPass retry block to safely wait for React event binding
    await expect(async () => {
      await analyticsTab.click();
      await expect(analyticsTab).toHaveClass(/active/);
    }).toPass({ timeout: 10000 });

    // 5. Verify stats and dashboard content are visible
    await expect(page.locator('text=Total Scans')).toBeVisible({ timeout: 10000 });
    await expect(page.locator('.kpi-value:has-text("42")')).toBeVisible();
    await expect(page.locator('.kpi-value:has-text("50.0%")')).toBeVisible();

    // Verify SVG charts exist
    const svgCharts = page.locator('svg.svg-chart');
    await expect(svgCharts.first()).toBeVisible();

    // Verify findings line and right-axis text exist
    const findingsLine = page.locator('path.svg-line-path-findings');
    await expect(findingsLine).toBeVisible();

    const rightAxisText = page.locator('text.chart-axis-text-findings');
    await expect(rightAxisText.first()).toBeVisible();
  });
});
