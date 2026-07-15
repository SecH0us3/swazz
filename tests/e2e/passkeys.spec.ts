import { test, expect } from '@playwright/test';

test.describe('Passkeys E2E Tests', () => {
  test('should allow registering a passkey and signing in with it', async ({ page, context }) => {
    // 1. Setup virtual authenticator using CDP session
    const client = await context.newCDPSession(page);
    await client.send('WebAuthn.enable');
    await client.send('WebAuthn.addVirtualAuthenticator', {
      options: {
        protocol: 'ctap2',
        transport: 'internal',
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true
      }
    });

    // 2. Navigate to the frontend and register a new user
    await page.goto('/');
    await page.getByRole('button', { name: 'Sign In' }).click();

    const createAccountBtn = page.getByRole('button', { name: 'Create an account' });
    await expect(createAccountBtn).toBeVisible();

    // Perform direct registration
    // Username length limited to under 20 chars per project rules
    const uniqueUsername = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    await page.locator('#username').fill(uniqueUsername);
    await page.locator('#password').fill('Password123!');
    await createAccountBtn.click();

    // Wait for main dashboard to load
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });

    // 3. Navigate to Profile Settings > Security (2FA)
    const accountBtn = page.locator('button[title="Account"]');
    await expect(accountBtn).toBeVisible();
    await accountBtn.click();

    const profileSettingsBtn = page.locator('button:has-text("Profile Settings")');
    await expect(profileSettingsBtn).toBeVisible();
    await profileSettingsBtn.click();

    // Verify Settings card is loaded
    const settingsHeader = page.getByRole('heading', { name: 'Settings', exact: true });
    await expect(settingsHeader).toBeVisible();

    // Select Security tab in settings
    const securityTabBtn = page.locator('button:has-text("Security (2FA)")');
    await expect(securityTabBtn).toBeVisible();
    await securityTabBtn.click();
    
    // Verify "Passkeys" section is visible
    const passkeysHeader = page.getByRole('heading', { name: 'Passkeys', exact: true });
    await expect(passkeysHeader).toBeVisible();

    // 4. Register a Passkey
    const registerPasskeyBtn = page.getByRole('button', { name: 'Register New Passkey' });
    await expect(registerPasskeyBtn).toBeVisible();
    await registerPasskeyBtn.click();

    // Verify the passkey appears in the list
    const passkeyItem = page.locator('.passkey-item').first();
    await expect(passkeyItem).toBeVisible({ timeout: 10000 });

    // 5. Log out
    await accountBtn.click();
    const logoutBtn = page.locator('button:has-text("Logout")');
    await logoutBtn.click();
    
    // Wait for the login screen to appear
    await expect(createAccountBtn).toBeVisible();

    // 6. Sign in with Passkey
    await page.locator('#username').fill(uniqueUsername);
    
    const passkeyLoginBtn = page.getByRole('button', { name: 'Sign in with Passkey' });
    await expect(passkeyLoginBtn).toBeVisible();
    await passkeyLoginBtn.click();

    // Verify successful login
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });
  });
});
