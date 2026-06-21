import { test, expect } from '@playwright/test';

test.describe('Project Lifecycle and Selection E2E Test', () => {
  test('should create a new project using dialog prompt and switch between projects', async ({ page }) => {
    // 1. Navigate to the frontend dev server
    await page.goto('/');

    // 2. Handle Login/Registration: Register a unique user
    await page.locator('button.link-btn:has-text("Sign up")').click();

    const uniqueUsername = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    await page.locator('#username').fill(uniqueUsername);
    await page.locator('#password').fill('password123');
    await page.locator('#password').press('Enter');

    // Wait for the main layout to load
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });

    // 3. Locate the Project Selector button
    const projectSelectorBtn = page.locator('.sidebar-project-selector button').first();
    await expect(projectSelectorBtn).toBeVisible();
    await expect(projectSelectorBtn).toContainText('Default Project');

    // 4. Set up Playwright's native dialog handler to respond to the prompt() window
    const newProjectName = 'E2E Test Project';
    page.once('dialog', async dialog => {
      expect(dialog.type()).toBe('prompt');
      expect(dialog.message()).toBe('Enter project name:');
      await dialog.accept(newProjectName);
    });

    // 5. Open the dropdown list and click "Create New Project"
    await projectSelectorBtn.click();
    const createProjectBtn = page.locator('button.dropdown-item:has-text("Create New Project")');
    await expect(createProjectBtn).toBeVisible();
    await createProjectBtn.click();

    // 6. Verify the active project changes to the newly created project
    await expect(projectSelectorBtn).toContainText(newProjectName);

    // 7. Open the dropdown again and switch back to "Default Project"
    await projectSelectorBtn.click();
    const defaultProjectItem = page.locator('button.dropdown-item:has-text("Default Project")');
    await expect(defaultProjectItem).toBeVisible();
    await defaultProjectItem.click();

    // 8. Assert that active project is updated back to "Default Project"
    await expect(projectSelectorBtn).toContainText('Default Project');
  });
});
