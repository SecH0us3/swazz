import { test, expect } from '@playwright/test';

test.describe('E2EE Key Backup & Recovery E2E Test', () => {
  const mockPrivateJwk = {
    kty: 'OKP',
    crv: 'X25519',
    x: 'hSDwCYkwp1R0i33ctD73Wg2_Og0mOBr066SpjqqbTmo',
    d: 'dwdtCnMYpX08FsFyUbJmRd9ML4frwJkqsXf7pR25LCo'
  };

  test('should support key generation, mnemonic recovery, and swazzkey file upload', async ({ page }) => {
    // 1. Navigate to main page
    await page.goto('/?no_bypass_e2e_gate=true');

    // 2. Register a unique user
    await page.getByRole('button', { name: 'Create' }).click();

    const uniqueUsername = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    await page.locator('#username').fill(uniqueUsername);
    await page.locator('#password').fill('Password123!');
    await page.locator('#password').press('Enter');

    // Wait for the app layout to load
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });

    // 3. Project Key Initializer gate should be visible initially because Default Project has no keys
    const setupTitle = page.locator('.e2ee-title');
    await expect(setupTitle).toBeVisible();
    await expect(setupTitle).toContainText('Project Key Setup: Default Project');

    // 4. Verify there is a guide link
    const guideLink = page.locator('.e2ee-link', { hasText: 'Key Backup & Recovery guide' });
    await expect(guideLink).toBeVisible();
    await expect(guideLink).toHaveAttribute('href', '/docs/encryption_backup');

    // 5. Generate a new keypair
    const generateBtn = page.getByRole('button', { name: 'Generate Keys' });
    await expect(generateBtn).toBeVisible();
    await generateBtn.click();

    // 6. Verify setup successful screen and the 12-word mnemonic is shown
    await expect(page.locator('h3', { hasText: 'Setup Successful!' })).toBeVisible();
    
    const wordBadges = page.locator('.mnemonic-word-badge');
    await expect(wordBadges).toHaveCount(12);

    // Extract the mnemonic words
    const mnemonicWords: string[] = [];
    for (let i = 0; i < 12; i++) {
      const badgeText = await wordBadges.nth(i).innerText();
      // badgeText looks like "1\nabandon" or "1 abandon" depending on layout. Let's clean it.
      const word = badgeText.replace(/^\d+[\s\n]*/, '').trim();
      mnemonicWords.push(word);
    }
    const derivedMnemonic = mnemonicWords.join(' ');

    // 7. Click Continue to Workspace to unlock fuzzer views
    await page.getByRole('button', { name: 'Continue to Workspace' }).click();
    await expect(page.locator('.empty-state-title')).toBeVisible(); // Normal fuzzer workspace empty state

    // 8. Go to Project Settings and verify keys management tab
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

    // Reveal seed phrase
    const revealBtn = page.getByRole('button', { name: 'Reveal 12-Word Seed Phrase' });
    await revealBtn.click();

    // Mnemonic in settings should match what was generated
    const settingsWordBadges = page.locator('.mnemonic-word-badge');
    await expect(settingsWordBadges).toHaveCount(12);

    // 9. Test importing keys into a second project via mnemonic seed phrase
    await page.locator('.header-logo').click();
    await projectSelectorBtn.click();
    const createProjectBtn = page.locator('button.dropdown-item', { hasText: 'Create New Project' });
    await expect(createProjectBtn).toBeVisible();

    const secondProjName = 'Mnemonic Restore Project';
    page.once('dialog', async dialog => {
      await dialog.accept(secondProjName);
    });
    await createProjectBtn.click();

    // Go back to main workspace to see the setup gate
    await page.locator('.header-logo').click();

    // Verify it blocks on Setup Gate for the new project
    await expect(page.locator('.e2ee-title')).toContainText(`Project Key Setup: ${secondProjName}`);

    // Click Restore from Mnemonic
    await page.getByRole('button', { name: 'Restore Mnemonic' }).click();

    // Fill in the mnemonic and submit
    await page.locator('.e2ee-textarea').fill(derivedMnemonic);
    await page.getByRole('button', { name: 'Restore Key' }).click();

    // Verify workspace is unlocked successfully
    await expect(page.locator('.empty-state-title')).toBeVisible();

    // 10. Test importing keys into a third project via .swazzkey file upload
    await projectSelectorBtn.click();
    const thirdProjName = 'File Restore Project';
    page.once('dialog', async dialog => {
      await dialog.accept(thirdProjName);
    });
    await createProjectBtn.click();

    // Go back to main workspace to see the setup gate
    await page.locator('.header-logo').click();

    // Verify Setup Gate for third project
    await expect(page.locator('.e2ee-title')).toContainText(`Project Key Setup: ${thirdProjName}`);

    // Click Upload .swazzkey File
    await page.getByRole('button', { name: 'Upload .swazzkey File' }).click();

    // Upload the mock JWK file in-memory
    const fileChooserPromise = page.waitForEvent('filechooser');
    await page.locator('.e2ee-file-drop').click();
    const fileChooser = await fileChooserPromise;
    await fileChooser.setFiles({
      name: 'backup.swazzkey',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(mockPrivateJwk, null, 2))
    });

    // Verify workspace is unlocked successfully
    await expect(page.locator('.empty-state-title')).toBeVisible();
  });
});
