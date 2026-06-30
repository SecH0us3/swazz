import { test, expect } from '@playwright/test';

test.describe('Project Lifecycle and Selection E2E Test', () => {
  test('should create a new project using dialog prompt and switch between projects', async ({ page }) => {
    // 1. Navigate to the frontend dev server
    await page.goto('/');

    // 2. Handle Login/Registration: Register a unique user
    await page.getByRole('button', { name: 'Create' }).click();

    const uniqueUsername = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    await page.locator('#username').fill(uniqueUsername);
    await page.locator('#password').fill('Password123!');
    await page.locator('#password').press('Enter');

    // Wait for the main layout to load
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });

    // 3. Locate the Project Selector button (avoiding .first() by targeting its specific class)
    const projectSelectorBtn = page.locator('.sidebar-project-selector button.btn-ghost');
    await expect(projectSelectorBtn).toBeVisible();
    await expect(projectSelectorBtn).toContainText('Default Project');

    // 4. Open the dropdown list
    await projectSelectorBtn.click();
    
    const createProjectBtn = page.locator('button.dropdown-item', { hasText: 'Create New Project' });
    await expect(createProjectBtn).toBeVisible();

    const newProjectName = 'E2E Test Project';
    
    // Register Playwright's native dialog handler immediately before the prompt-triggering action
    page.once('dialog', async dialog => {
      expect(dialog.type()).toBe('prompt');
      expect(dialog.message()).toBe('Enter project name:');
      await dialog.accept(newProjectName);
    });

    // 5. Trigger the prompt by clicking create button
    await createProjectBtn.click();

    // 6. Verify the active project changes to the newly created project
    await expect(projectSelectorBtn).toContainText(newProjectName);

    // 7. Open the dropdown again and switch back to "Default Project"
    await projectSelectorBtn.click();
    const defaultProjectItem = page.locator('button.dropdown-item', { hasText: 'Default Project' });
    await expect(defaultProjectItem).toBeVisible();
    await defaultProjectItem.click();

    // 8. Assert that active project is updated back to "Default Project"
    await expect(projectSelectorBtn).toContainText('Default Project');
  });
});
