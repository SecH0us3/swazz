import { test, expect } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';

test.describe('Runner Agent Disconnection & Failover E2E Test', () => {
  let secondAgent: ChildProcess | null = null;

  test.afterEach(() => {
    if (secondAgent) {
      secondAgent.kill();
      secondAgent = null;
    }
  });

  test('should failover fuzzing tasks when a runner agent disconnects midway', async ({ page }) => {
    // Enable diagnostics logging
    page.on('console', msg => console.log(`BROWSER CONSOLE [${msg.type()}]: ${msg.text()}`));
    page.on('pageerror', exception => console.log(`BROWSER EXCEPTION: ${exception}`));

    // 1. Navigate to the frontend dev server
    await page.goto('/');

    // 2. Handle Login/Registration: Register a unique user
    await page.getByRole('button', { name: 'Sign up' }).click();

    const uniqueUsername = `u${Date.now().toString().slice(-6)}_${Math.floor(Math.random() * 1000)}`;
    await page.locator('#username').fill(uniqueUsername);
    await page.locator('#password').fill('password123');

    const configPromise = page.waitForResponse(resp => resp.url().includes('/config') && resp.status() === 200);
    await page.locator('#password').press('Enter');

    // Wait for the main layout to load
    await expect(page.locator('.app-layout')).toBeVisible({ timeout: 15000 });
    await configPromise;

    // 3. Spawn a second runner agent process
    const isWindows = process.platform === 'win32';
    const agentBinary = path.join(process.cwd(), 'packages/container', isWindows ? 'swazz-engine.exe' : 'swazz-engine');
    const agentName = 'runner-failover-agent';
    
    console.log(`Spawning second agent process: ${agentBinary}`);
    secondAgent = spawn(agentBinary, [
      'run-agent',
      '--coordinator', 'ws://127.0.0.1:8787/api/runners/connect',
      '--token', 'swazz_live_citoken1234567890',
      '--dangerous-no-container',
      '--name', agentName
    ]);

    // Handle process output to aid debugging
    secondAgent.stdout?.on('data', data => console.log(`AGENT STDOUT: ${data}`));
    secondAgent.stderr?.on('data', data => console.log(`AGENT STDERR: ${data}`));

    // 4. Verify that the second agent connects and is visible in the settings
    const moreSettingsBtn = page.locator('button:has-text("More Project Settings")');
    await expect(moreSettingsBtn).toBeVisible();
    await moreSettingsBtn.click();

    await expect(page.locator('h1:has-text("Project Settings")')).toBeVisible();

    const activeRunnersTab = page.locator('button.tab-bar-btn:has-text("Active Runners")');
    await expect(activeRunnersTab).toBeVisible();
    await activeRunnersTab.click();

    // Verify both our primary agent and the new runner-failover-agent are listed
    const secondRunnerRow = page.locator(`.runner-name:has-text("${agentName}")`);
    await expect(secondRunnerRow).toBeVisible({ timeout: 15000 });

    // 5. Go back to Dashboard
    const backBtn = page.locator('button:has-text("Back to Dashboard")');
    await expect(backBtn).toBeVisible();
    await backBtn.click();

    // 6. Add the Swagger spec of our local Vulnerable Demo API
    const specUrlInput = page.locator('input[placeholder="https://api.com/swagger.json or /graphql"]');
    await expect(specUrlInput).toBeVisible();
    
    const demoSpecUrl = 'http://127.0.0.1:8788/swagger.json';
    await specUrlInput.fill(demoSpecUrl);
    
    const addBtn = page.locator('button.btn-primary:has-text("Add")');
    await addBtn.click();

    // Wait for endpoints list to render
    const endpointItems = page.locator('.tree-leaf-row');
    await expect(endpointItems.first()).toBeVisible({ timeout: 15000 });

    // 7. Trigger fuzzing by clicking the Start button
    const startBtn = page.locator('#btn-start');
    await expect(startBtn).toBeVisible();
    await startBtn.click();

    const stopBtn = page.locator('button.btn-danger[title="Stop"]');
    await expect(stopBtn).toBeVisible({ timeout: 10000 });

    // Wait for logs tab to start showing fuzzer request logs count (indicating active scanning)
    const logsTab = page.locator('button.tab-bar-btn:has-text("Request Logs")');
    await expect(logsTab).toBeVisible();
    // Wait until there is at least one digit in the count
    await expect(logsTab).toContainText(/[1-9]\d*/, { timeout: 15000 });

    // 8. Kill the second runner agent midway!
    console.log(`Killing second agent runner: ${agentName}`);
    secondAgent.kill();
    secondAgent = null;

    // 9. Wait for the fuzzer to complete (Start button becomes visible again)
    await expect(startBtn).toBeVisible({ timeout: 60000 });

    // 10. Verify scan completed successfully and we have findings
    const owaspTab = page.locator('button.tab-bar-btn:has-text("OWASP Top 10")');
    await expect(owaspTab).toBeVisible();
    await owaspTab.click();

    const summaryBanner = page.locator('.owasp-summary-count');
    await expect(summaryBanner).toHaveText(/\d+ Finding[s]? Detected/, { timeout: 10000 });
  });
});
