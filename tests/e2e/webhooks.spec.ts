import { test, expect } from '@playwright/test';

test.describe('Webhooks Tab E2E Tests', () => {
  test('should support creating, testing, editing, and deleting webhooks', async ({ page }) => {
    // 1. Navigate to the frontend dev server
    await page.goto('/');

    // 2. Handle Login/Registration
    await page.getByRole('button', { name: 'Create' }).click();

    const uniqueUsername = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    await page.locator('#username').fill(uniqueUsername);
    await page.locator('#password').fill('Password123!');
    await page.locator('#password').press('Enter');

    // Wait for the main layout to load
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });

    // 3. Navigate to Project Settings
    const moreSettingsBtn = page.locator('button:has-text("More Project Settings")');
    await expect(moreSettingsBtn).toBeVisible();
    await moreSettingsBtn.click();

    const settingsHeader = page.locator('h1:has-text("Project Settings")');
    await expect(settingsHeader).toBeVisible();

    // 4. Click on Webhooks tab
    const webhooksTabBtn = page.locator('#tab-webhooks');
    await expect(webhooksTabBtn).toBeVisible();
    await webhooksTabBtn.click();

    // 5. Verify the empty state
    await expect(page.locator('.webhooks-empty-state')).toContainText('No webhooks configured for this project yet.');

    // 6. Click Add Webhook
    await page.locator('button.webhooks-add-btn').click();

    // Verify form fields
    const urlInput = page.locator('input.webhook-url-input');
    await expect(urlInput).toBeVisible();
    await urlInput.fill('https://example.com/e2e-webhook');

    const headersTextarea = page.locator('textarea.webhook-headers-textarea');
    await expect(headersTextarea).toBeVisible();
    await headersTextarea.fill('{\n  "X-E2E-Test": "True"\n}');

    // Toggle scan.started event
    const startedEventLabel = page.locator('.webhook-event-checkbox-label', { hasText: 'Scan Started' });
    await expect(startedEventLabel).toBeVisible();
    await startedEventLabel.click();

    // Submit form
    await page.locator('button.webhook-submit-btn').click();

    // 7. Verify the webhook appears in the list
    await expect(page.locator('.webhook-card-url')).toContainText('https://example.com/e2e-webhook');
    await expect(page.locator('.webhook-badge', { hasText: 'scan.started' })).toBeVisible();

    // Verify the secret key is displayed and masked
    const secretValue = page.locator('.webhook-secret-value');
    await expect(secretValue).toContainText('••••••••••••••••••••••••••••••••');

    // Click Reveal and verify it displays the whsec_ prefix
    const toggleSecretBtn = page.locator('button.webhook-secret-toggle');
    await expect(toggleSecretBtn).toContainText('Reveal');
    await toggleSecretBtn.click();
    await expect(secretValue).toContainText('whsec_');
    await expect(toggleSecretBtn).toContainText('Hide');

    // Click Hide and verify it masks it again
    await toggleSecretBtn.click();
    await expect(secretValue).toContainText('••••••••••••••••••••••••••••••••');
    await expect(toggleSecretBtn).toContainText('Reveal');

    // Verify copy button is present
    const copySecretBtn = page.locator('button.webhook-secret-copy');
    await expect(copySecretBtn).toBeVisible();

    // 8. Test Connection
    // Stub fetch globally or intercept the route
    await page.route('**/api/projects/*/webhooks/*/test', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ status: 'success', statusCode: 200 })
      });
    });

    const testBtn = page.locator('button.webhook-test-btn');
    await expect(testBtn).toBeVisible();
    await testBtn.click();

    // Check toast/notification
    await expect(page.getByText('Test payload sent successfully')).toBeVisible({ timeout: 10000 });

    // 9. Edit Webhook
    await page.locator('button.webhook-edit-btn').click();
    await urlInput.fill('https://example.com/e2e-webhook-edited');
    await page.locator('button.webhook-submit-btn').click();

    await expect(page.locator('.webhook-card-url')).toContainText('https://example.com/e2e-webhook-edited');

    // 10. Delete Webhook
    page.once('dialog', async dialog => {
      expect(dialog.message()).toContain('Are you sure you want to delete this webhook?');
      await dialog.accept();
    });

    await page.locator('button.webhook-delete-btn').click();
    await expect(page.locator('.webhooks-empty-state')).toContainText('No webhooks configured for this project yet.');
  });
});
