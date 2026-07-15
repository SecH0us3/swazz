import { test, expect } from '@playwright/test';

test.describe('E2EE Key Backup & Recovery E2E Test', () => {
  const mockPrivateJwk = {
    kty: 'OKP',
    crv: 'X25519',
    x: 'hSDwCYkwp1R0i33ctD73Wg2_Og0mOBr066SpjqqbTmo',
    d: 'dwdtCnMYpX08FsFyUbJmRd9ML4frwJkqsXf7pR25LCo'
  };

  test('should support background generation, backup download, and setting restore', async ({ page }) => {
    // 1. Navigate to main page and sign in
    await page.goto('/');
    await page.getByRole('button', { name: 'Sign In' }).click();

    // 2. Register a unique user
    await page.getByRole('button', { name: 'Create an account' }).click();

    const uniqueUsername = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    await page.locator('#username').fill(uniqueUsername);
    await page.locator('#password').fill('Password123!');
    await page.locator('#password').press('Enter');

    // Wait for the app layout to load directly into fuzzer workspace
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('.empty-state-title')).toBeVisible();

    // 3. Confirm the E2EE Backup Banner is visible at the top of the workspace
    const backupBanner = page.locator('.e2ee-backup-banner');
    await expect(backupBanner).toBeVisible();
    await expect(backupBanner).toContainText('Project scan reports are encrypted end-to-end');

    // 4. Click "Show Seed Phrase" to open the Mnemonic Modal
    await page.getByRole('button', { name: 'Show Seed Phrase' }).click();

    const mnemonicModal = page.locator('.e2ee-modal-overlay');
    await expect(mnemonicModal).toBeVisible();

    const wordBadges = page.locator('.mnemonic-word-badge');
    await expect(wordBadges).toHaveCount(12);

    // Extract the mnemonic words
    const mnemonicWords: string[] = [];
    for (let i = 0; i < 12; i++) {
      const badgeText = await wordBadges.nth(i).innerText();
      const word = badgeText.replace(/^\d+[\s\n]*/, '').trim();
      mnemonicWords.push(word);
    }
    const derivedMnemonic = mnemonicWords.join(' ');

    // Click "Done" to close the Mnemonic Modal
    await page.getByRole('button', { name: 'Done' }).click();
    await expect(mnemonicModal).not.toBeVisible();

    // 5. Test downloading the backup
    // Trigger download and verify banner disappears
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download Backup (.swazzkey)' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toContain('.swazzkey');
    await expect(backupBanner).not.toBeVisible();

    // 6. Go to Project Settings -> Encryption Keys tab
    const projectSelectorBtn = page.locator('.sidebar-project-selector button.btn-ghost');
    await projectSelectorBtn.click();
    await page.locator('button.dropdown-item', { hasText: 'Project Settings' }).click();

    // Select Encryption Keys tab
    const keysTabBtn = page.locator('button.tab-bar-btn', { hasText: 'Encryption Keys' });
    await expect(keysTabBtn).toBeVisible();
    await keysTabBtn.click();

    // Public key should be populated
    const pubKeyInput = page.locator('.e2ee-mono-input');
    await expect(pubKeyInput).toBeVisible();
    const pubKeyVal = await pubKeyInput.inputValue();
    expect(pubKeyVal.length).toBeGreaterThan(10);

    // 7. Create a second project to test key restore
    await page.locator('.header-logo').click();
    await projectSelectorBtn.click();
    const createProjectBtn = page.locator('button.dropdown-item', { hasText: 'Create New Project' });
    await expect(createProjectBtn).toBeVisible();

    const secondProjName = 'Restore Test Project';
    page.once('dialog', async dialog => {
      await dialog.accept(secondProjName);
    });
    await createProjectBtn.click();

    // Go to project settings
    await page.locator('.header-logo').click();
    await projectSelectorBtn.click();
    await page.locator('button.dropdown-item', { hasText: 'Project Settings' }).click();
    await keysTabBtn.click();

    // Click "Restore from Backup / Mnemonic"
    await page.getByRole('button', { name: 'Restore from Backup / Mnemonic' }).click();

    // Fill mnemonic and restore
    await page.locator('.textarea').fill(derivedMnemonic);
    await page.getByRole('button', { name: 'Import' }).click();

    // The restore input should close, meaning restoration was successful
    await expect(page.locator('.textarea')).not.toBeVisible();

    // 8. Test file upload restore on the same project
    await page.getByRole('button', { name: 'Restore from Backup / Mnemonic' }).click();
    await page.getByRole('button', { name: 'Use Backup File' }).click();

    // Upload the mock JWK file in-memory
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('.file-upload-label').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: 'backup.swazzkey',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(mockPrivateJwk, null, 2))
    });

    // The modal restore input should close, meaning restoration was successful
    await expect(page.locator('.file-upload-label')).not.toBeVisible();
  });
});
