import { test, expect } from '@playwright/test';
import { webcrypto } from 'crypto';

// Base32 Alphabet
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function base32Decode(input: string): Uint8Array {
  const cleanInput = input.toUpperCase().replace(/=+$/, '');
  const length = cleanInput.length;
  const buffer = new Uint8Array(Math.floor((length * 5) / 8));
  
  let bits = 0;
  let value = 0;
  let index = 0;
  
  for (let i = 0; i < length; i++) {
    const idx = ALPHABET.indexOf(cleanInput[i]);
    if (idx === -1) {
      throw new Error(`Invalid Base32 character: ${cleanInput[i]}`);
    }
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      buffer[index++] = (value >>> (bits - 8)) & 0xff;
      bits -= 8;
    }
  }
  
  return buffer;
}

async function generateTOTP(secret: string): Promise<string> {
  const keyBytes = base32Decode(secret);
  const counter = Math.floor(Date.now() / 1000 / 30);
  
  const key = await webcrypto.subtle.importKey(
    'raw',
    keyBytes,
    { name: 'HMAC', hash: { name: 'SHA-1' } },
    false,
    ['sign']
  );
  
  const counterBuffer = new ArrayBuffer(8);
  const dataView = new DataView(counterBuffer);
  dataView.setUint32(0, 0);
  dataView.setUint32(4, counter);
  
  const signature = await webcrypto.subtle.sign('HMAC', key, counterBuffer);
  const signatureBytes = new Uint8Array(signature);
  
  const offset = signatureBytes[signatureBytes.length - 1] & 0x0f;
  const binary =
    ((signatureBytes[offset] & 0x7f) << 24) |
    ((signatureBytes[offset + 1] & 0xff) << 16) |
    ((signatureBytes[offset + 2] & 0xff) << 8) |
    (signatureBytes[offset + 3] & 0xff);
    
  const otp = binary % 1000000;
  return otp.toString().padStart(6, '0');
}

test.describe('Two-Factor Authentication (2FA) E2E Tests', () => {
  test('should allow setting up, verifying, logging in with, and disabling 2FA', async ({ page }) => {
    // Enable diagnostics logging
    page.on('console', msg => console.log(`BROWSER CONSOLE [${msg.type()}]: ${msg.text()}`));
    page.on('pageerror', exception => console.log(`BROWSER EXCEPTION: ${exception}`));

    // 1. Navigate to the frontend
    await page.goto('/');

    const createAccountBtn = page.getByRole('button', { name: 'Create Account' });
    const enterWorkspaceBtn = page.getByRole('button', { name: 'Enter Workspace' });
    await expect(createAccountBtn).toBeVisible();

    // 2. Perform direct registration
    const uniqueUsername = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    await page.locator('#username').fill(uniqueUsername);
    await page.locator('#password').fill('password123');
    await createAccountBtn.click();

    // Wait for main dashboard to load
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });

    // 3. Navigate to Profile Settings
    const accountBtn = page.locator('button[title="Account"]');
    await expect(accountBtn).toBeVisible();
    await accountBtn.click();

    const profileSettingsBtn = page.locator('button:has-text("Profile Settings")');
    await expect(profileSettingsBtn).toBeVisible();
    await profileSettingsBtn.click();

    // Verify Settings card is loaded and 2FA section is visible
    const settingsHeader = page.getByRole('heading', { name: 'Settings', exact: true });
    await expect(settingsHeader).toBeVisible();

    // Select Security tab in settings
    const securityTabBtn = page.locator('button:has-text("Security (2FA)")');
    await expect(securityTabBtn).toBeVisible();
    await securityTabBtn.click();
    
    const twoFactorHeader = page.getByRole('heading', { name: 'Two-Factor Authentication (2FA)', exact: true });
    await expect(twoFactorHeader).toBeVisible();

    // Fill password to confirm identity for 2FA Setup
    await page.locator('#totp-setup-password').fill('password123');

    // 4. Click Set Up 2FA
    const setUp2faBtn = page.getByRole('button', { name: 'Set Up 2FA' });
    await expect(setUp2faBtn).toBeVisible();
    await setUp2faBtn.click();

    // Extract secret key
    const secretDisplay = page.locator('.two-factor-secret-key-display');
    await expect(secretDisplay).toBeVisible();
    const secret = (await secretDisplay.textContent())?.trim();
    expect(secret).toBeTruthy();
    expect(secret?.length).toBe(16);

    // 5. Verify 2FA
    const validCode = await generateTOTP(secret!);
    await page.locator('#totp-setup-code').fill(validCode);
    
    const verifyEnableBtn = page.getByRole('button', { name: 'Verify & Enable' });
    await expect(verifyEnableBtn).toBeVisible();
    await verifyEnableBtn.click();

    // Verify 2FA status badge shows "Enabled"
    const statusBadge = page.locator('.two-factor-status-badge');
    await expect(statusBadge).toHaveText('Enabled');
    await expect(statusBadge).toHaveClass(/enabled/);

    // 6. Log out
    await accountBtn.click();
    const logoutBtn = page.locator('button:has-text("Logout")');
    await logoutBtn.click();
    await expect(createAccountBtn).toBeVisible();

    // 7. Login (should trigger 2FA)
    await page.locator('#username').fill(uniqueUsername);
    await page.locator('#password').fill('password123');
    await enterWorkspaceBtn.click();

    // Verify 2FA screen shows up
    const twoFactorVerifyHeader = page.getByRole('heading', { name: 'Two-Factor Verification', exact: true });
    await expect(twoFactorVerifyHeader).toBeVisible();

    // Submit valid 2FA code
    const freshCode = await generateTOTP(secret!);
    await page.locator('#twoFactorCode').fill(freshCode);
    
    const verifyLoginBtn = page.getByRole('button', { name: 'Verify' });
    await expect(verifyLoginBtn).toBeVisible();
    await verifyLoginBtn.click();

    // Wait for main dashboard to load
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });

    // 8. Go back to Profile Settings to disable 2FA
    await accountBtn.click();
    await profileSettingsBtn.click();

    // Select Security tab in settings
    const securityTabBtn2 = page.locator('button:has-text("Security (2FA)")');
    await expect(securityTabBtn2).toBeVisible();
    await securityTabBtn2.click();
    await expect(twoFactorHeader).toBeVisible();

    // Disable 2FA
    await page.locator('#totp-disable-password').fill('password123');

    const disableCode = await generateTOTP(secret!);
    await page.locator('#totp-disable-code').fill(disableCode);
    
    const disableBtn = page.getByRole('button', { name: 'Disable 2FA' });
    await expect(disableBtn).toBeVisible();
    await disableBtn.click();

    // Verify 2FA status badge shows "Disabled" and password input button is back
    await expect(statusBadge).toHaveText('Disabled');
    await expect(statusBadge).toHaveClass(/disabled/);
    await expect(page.locator('#totp-setup-password')).toBeVisible();
  });
});
