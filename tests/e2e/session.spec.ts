import { test, expect } from '@playwright/test';

test.describe('Session Expiration and Authentication Flow E2E Test', () => {
  test('should redirect to login screen when session token becomes invalid or expired (401)', async ({ page }) => {
    // 1. Navigate to the frontend dev server
    await page.goto('/');
    await page.getByRole('button', { name: 'Sign In' }).click();

    // 2. Handle Login/Registration: Register a unique user
    await page.getByRole('button', { name: 'Create an account' }).click();

    const uniqueUsername = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    await page.locator('#username').fill(uniqueUsername);
    await page.locator('#password').fill('Password123!');
    await page.locator('#password').press('Enter');

    // Wait for the main layout to load
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });

    // 3. Programmatically corrupt/expire the session token in localStorage
    await page.evaluate(() => {
      localStorage.setItem('swazz_token', 'invalid-expired-session-token');
    });

    // 4. Reload page to trigger profile check with the expired token
    await page.reload();
    await page.waitForTimeout(2000);

    // 5. Verify that the user is logged out and redirected back to the login screen
    const loginHeader = page.locator('h2:has-text("Welcome to Swazz")');
    await expect(loginHeader).toBeVisible({ timeout: 15000 });

    // 6. Assert that localStorage token is cleaned up
    const token = await page.evaluate(() => localStorage.getItem('swazz_token'));
    expect(token).toBeNull();
  });

  test('should enforce custom project session timeout and redirect to login screen', async ({ page }) => {
    // 1. Navigate to the frontend dev server
    await page.goto('/');
    await page.getByRole('button', { name: 'Sign In' }).click();

    // 2. Register a unique user (using registration username limit rules 3 to 20 chars)
    await page.getByRole('button', { name: 'Create an account' }).click();

    const uniqueUsername = `u${Date.now().toString().slice(-5)}_${Math.floor(Math.random() * 100)}`;
    await page.locator('#username').fill(uniqueUsername);
    await page.locator('#password').fill('Password123!');
    await page.locator('#password').press('Enter');

    // Wait for the main layout to load
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });

    // 3. Open Project Settings page
    const moreSettingsBtn = page.locator('button:has-text("More Project Settings")');
    await expect(moreSettingsBtn).toBeVisible();
    await moreSettingsBtn.click();

    // 4. Change Member Session Expiration dropdown value to "1 Hour" (3600 seconds)
    const sessionSelect = page.locator('label:has-text("Member Session Expiration") ~ select');
    await expect(sessionSelect).toBeVisible();
    await sessionSelect.selectOption('3600');

    // 5. Click Save General Info button
    const saveBtn = page.locator('button[type="submit"]:has-text("Save General Info")');
    await saveBtn.click();

    // 6. Wait for the "Saved successfully" indicator
    const savedIndicator = page.locator('span:has-text("Saved successfully")');
    await expect(savedIndicator).toBeVisible({ timeout: 10000 });

    // 7. Tamper with token iat in localStorage to make it 2 hours old and re-sign it with test secret
    await page.evaluate(async () => {
      const token = localStorage.getItem('swazz_token');
      if (!token) return;
      
      const parts = token.split('.');
      if (parts.length !== 3) return;
      
      const payloadStr = atob(parts[1].replace(/-/g, "+").replace(/_/g, "/"));
      const payload = JSON.parse(payloadStr);
      
      // Backdate to 2 hours ago (7200 seconds ago)
      payload.iat = Math.floor(Date.now() / 1000) - 7200;
      
      // Inline HMAC-SHA256 signer using web crypto API
      const signJwt = async (payloadObj: any, secretStr: string) => {
        const header = { alg: "HS256", typ: "JWT" };
        const enc = new TextEncoder();
        const base64UrlEncode = (json: any) => {
          const base64 = btoa(typeof json === 'string' ? json : JSON.stringify(json));
          return base64.replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
        };
        const encodedHeader = base64UrlEncode(header);
        const encodedPayload = base64UrlEncode(payloadObj);
        const message = `${encodedHeader}.${encodedPayload}`;
        
        const key = await crypto.subtle.importKey(
          "raw",
          enc.encode(secretStr),
          { name: "HMAC", hash: "SHA-256" },
          false,
          ["sign"]
        );
        const signature = await crypto.subtle.sign(
          "HMAC",
          key,
          enc.encode(message)
        );
        const encodedSignature = btoa(String.fromCharCode(...new Uint8Array(signature)))
          .replace(/=/g, "")
          .replace(/\+/g, "-")
          .replace(/\//g, "_");
        return `${message}.${encodedSignature}`;
      };
      
      const expiredToken = await signJwt(payload, 'test-secret');
      localStorage.setItem('swazz_token', expiredToken);
    });

    // 8. Reload page to trigger authorization with the backdated token
    await page.reload();
    await page.waitForTimeout(2000);

    // 9. Verify that user gets redirected back to the login screen
    const loginHeader = page.locator('h2:has-text("Welcome to Swazz")');
    await expect(loginHeader).toBeVisible({ timeout: 15000 });

    // 10. Verify that localStorage token was cleared
    const token = await page.evaluate(() => localStorage.getItem('swazz_token'));
    expect(token).toBeNull();
  });
});
