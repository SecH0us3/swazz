import { test, expect } from '@playwright/test';

test.describe('HAR File Import (Traffic Replay Fuzzing) E2E Test', () => {
  test('should import a HAR file, extract endpoints, and successfully run fuzzing', async ({ page }) => {
    // 1. Navigate to the frontend dev server
    await page.goto('/');

    // 2. Handle Login/Registration: Register a unique user
    const signUpLink = page.locator('button.link-btn:has-text("Sign up")');
    if (await signUpLink.isVisible()) {
      await signUpLink.click();
    }

    // Username limit is 3-20 characters
    const uniqueUsername = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    await page.locator('#username').fill(uniqueUsername);
    await page.locator('#password').fill('password123');
    await page.locator('#password').press('Enter');

    // Wait for the main layout to load
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });

    // 3. Fill the Swagger URL input with the mock HAR endpoint
    const specUrlInput = page.locator('input[placeholder="https://api.com/swagger.json or /graphql"]');
    await expect(specUrlInput).toBeVisible();
    
    const harUrl = 'http://127.0.0.1:8788/demo.har';
    await specUrlInput.fill(harUrl);

    const addBtn = page.locator('button.btn-primary:has-text("Add")');
    await addBtn.click();

    // Verify the URL text is updated to reflect the imported HAR file
    await expect(page.locator('.swagger-url-text')).toHaveText(harUrl);

    // Wait for the endpoints extracted from the HAR file to populate in the sidebar
    // We expect GET /welcome, GET /users, and GET /api/goods (which renders as GET goods under the /api/ folder)
    const welcomeLeaf = page.locator('.tree-leaf-row:has-text("GET"):has-text("/welcome")');
    const usersLeaf = page.locator('.tree-leaf-row:has-text("GET"):has-text("/users")');
    const goodsLeaf = page.locator('.tree-leaf-row:has-text("GET"):has-text("goods")');

    await expect(welcomeLeaf).toBeVisible({ timeout: 15000 });
    await expect(usersLeaf).toBeVisible({ timeout: 15000 });
    await expect(goodsLeaf).toBeVisible({ timeout: 15000 });

    // 4. Click the Start button to run the fuzzer on the imported HAR endpoints
    const startBtn = page.locator('#btn-start');
    await expect(startBtn).toBeVisible();
    await startBtn.click();

    // Wait for the fuzzer to start (button becomes hidden)
    await expect(startBtn).toBeHidden();

    // Wait for the fuzzer to complete (timeout of 60s max since it's a small mock HAR)
    await expect(startBtn).toBeVisible({ timeout: 60000 });

    // 5. Navigate to "Request Logs" tab to verify requests were sent
    const requestLogsTab = page.locator('button:has-text("Request Logs")');
    await expect(requestLogsTab).toBeVisible();
    await requestLogsTab.click();

    // Use search filtering to find log rows due to virtuoso list virtualization
    const searchInput = page.locator('input[placeholder="Filter by path…"]');
    await expect(searchInput).toBeVisible();

    // Verify /welcome requests
    await searchInput.fill('/welcome');
    const welcomeLog = page.locator('.log-path:has-text("/welcome")').first();
    await expect(welcomeLog).toBeVisible({ timeout: 10000 });

    // Verify /users requests
    await searchInput.fill('/users');
    const usersLog = page.locator('.log-path:has-text("/users")').first();
    await expect(usersLog).toBeVisible({ timeout: 10000 });

    // Verify /api/goods requests
    await searchInput.fill('/api/goods');
    const goodsLog = page.locator('.log-path:has-text("/api/goods")').first();
    await expect(goodsLog).toBeVisible({ timeout: 10000 });
  });

  test('should display toast error message when attempting to load an invalid HAR/spec URL', async ({ page }) => {
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
    await page.locator('#password').press('Enter');

    // Wait for the main layout to load
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });

    // 3. Fill the Swagger URL input with a non-existent endpoint
    const specUrlInput = page.locator('input[placeholder="https://api.com/swagger.json or /graphql"]');
    await expect(specUrlInput).toBeVisible();
    
    const invalidUrl = 'http://127.0.0.1:8788/non-existent.har';
    await specUrlInput.fill(invalidUrl);

    const addBtn = page.locator('button.btn-primary:has-text("Add")');
    await addBtn.click();

    // 4. Verify toast error container is shown with failure text
    const toastError = page.locator('.toast', { hasText: 'Failed' });
    await expect(toastError).toBeVisible({ timeout: 10000 });
  });
});
