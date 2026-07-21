import { test, expect } from '@playwright/test';

test.describe('Guest Login E2E Test', () => {
  test('should allow entering as guest, parsing a spec, starting fuzzing, and logging out', async ({ page }) => {
    // Enable diagnostics logging
    page.on('console', msg => console.log(`BROWSER CONSOLE [${msg.type()}]: ${msg.text()}`));
    page.on('pageerror', exception => console.log(`BROWSER EXCEPTION: ${exception}`));
    page.on('requestfailed', req => console.log(`BROWSER REQUEST FAILED: ${req.url()} - ${req.failure()?.errorText}`));
    page.on('response', res => {
      if (res.status() >= 400) {
        console.log(`BROWSER RESPONSE ERROR: ${res.url()} -> ${res.status()}`);
      }
    });

    // 1. Navigate to the frontend dev server
    await page.goto('/');
    await page.getByRole('button', { name: 'Sign In' }).click();

    // 2. Click "Try as guest →"
    const guestBtn = page.getByRole('button', { name: 'Try as guest →' });
    await expect(guestBtn).toBeVisible();
    await guestBtn.click();

    // 3. Wait for the main layout to load
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });

    // 4. Verify guest badge is shown in the header
    const guestBadge = page.locator('.guest-badge');
    await expect(guestBadge).toBeVisible();
    await expect(guestBadge).toContainText('Guest Mode');

    // 5. Add the Swagger spec of our local Vulnerable Demo API
    const specUrlInput = page.locator('input[placeholder="https://api.com/swagger.json or /graphql"]');
    await expect(specUrlInput).toBeVisible();
    
    // We assume Vulnerable Demo API runs on port 8788
    const demoSpecUrl = 'http://127.0.0.1:8788/swagger.json';
    await specUrlInput.fill(demoSpecUrl);
    
    const addBtn = page.locator('button.btn-primary:has-text("Add")');
    await addBtn.click();

    // 6. Verify endpoints are populated in the sidebar (confirms /api/parse works!)
    await expect(page.locator('.swagger-url-text')).toHaveText(demoSpecUrl);
    const endpointItems = page.locator('.tree-leaf-row');
    await expect(endpointItems.first()).toBeVisible({ timeout: 15000 });

    // 7. Verify target base URL input is populated in the header
    const targetInput = page.locator('input.header-target-input');
    await expect(targetInput).toBeVisible();
    const targetVal = await targetInput.inputValue();
    expect(targetVal).toContain('127.0.0.1:8788');

    // 8. Trigger fuzzing by clicking the Start button (confirms /api/runs works!)
    const startBtn = page.locator('#btn-start');
    await expect(startBtn).toBeVisible();
    await startBtn.click();

    // 9. Verify the run starts (Stop button becomes visible)
    const stopBtn = page.locator('button.btn-danger[title="Stop"]');
    await expect(stopBtn).toBeVisible({ timeout: 10000 });

    // Stop fuzzing
    await stopBtn.click();

    // 10. Click "Sign Up" button in the header to open in-app registration modal
    const signUpBtn = page.locator('.sign-up-btn');
    await expect(signUpBtn).toBeVisible();
    await signUpBtn.click();

    // 11. Verify in-app AuthModal pops up over the workspace
    const authModal = page.locator('.auth-modal');
    await expect(authModal).toBeVisible();
    await expect(page.getByText('Join the Beta')).toBeVisible();

    // 12. Register a new user in-place to convert guest session to registered session
    const testUsername = `guest_${Date.now().toString().slice(-6)}`;
    await page.locator('input#username').fill(testUsername);
    await page.locator('input#password').fill('TestPassword123!');
    await page.locator('button.primary-submit-btn').click();

    // 13. Verify modal closes and session upgrades to registered user
    await expect(authModal).not.toBeVisible({ timeout: 10000 });
    await expect(page.locator('.guest-badge')).not.toBeVisible();
  });
});
