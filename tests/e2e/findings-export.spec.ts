// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import { mockEnterpriseLicense, registerAndLogin, TIMEOUTS, disableBoundaryProfile } from './helpers';

test.describe('Findings Compact Grouped Export E2E Tests', () => {
  test('exports compact grouped JSON/Markdown (1 or 2 examples) and full scan log from Findings tab', async ({ page }) => {
    await mockEnterpriseLicense(page);
    await registerAndLogin(page);

    const specUrlInput = page.locator('input[placeholder="https://api.com/swagger.json or /graphql"]');
    await expect(specUrlInput).toBeVisible();
    await specUrlInput.fill('http://127.0.0.1:8788/swagger.json');
    await page.locator('button.btn-primary:has-text("Add")').click();
    await expect(page.locator('.tree-leaf-row').first()).toBeVisible({ timeout: TIMEOUTS.LOAD });

    await disableBoundaryProfile(page);

    const startBtn = page.locator('#btn-start');
    await expect(startBtn).toBeVisible();
    await startBtn.click();

    const stopBtn = page.locator('button.btn-danger[title="Stop"]');
    await expect(stopBtn).toBeVisible({ timeout: TIMEOUTS.DEFAULT });

    const findingsTab = page.locator('button.tab-bar-btn:has-text("Findings")');
    await findingsTab.click();

    const expandAllBtn = page.locator('button:has-text("Expand All")');
    await expect(expandAllBtn).toBeVisible({ timeout: TIMEOUTS.LOAD });
    if (await stopBtn.isVisible()) {
      await stopBtn.click();
    }
    await expect(startBtn).toBeVisible({ timeout: TIMEOUTS.LOAD });

    const exportTrigger = page.locator('button.findings-export-trigger');
    await expect(exportTrigger).toBeVisible({ timeout: TIMEOUTS.DEFAULT });
    await exportTrigger.click();

    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();

    // Ensure menu fits inside viewport without clipping
    const box = await menu.boundingBox();
    const viewport = page.viewportSize();
    expect(box).not.toBeNull();
    if (box && viewport) {
      expect(box.x).toBeGreaterThanOrEqual(0);
      expect(box.y).toBeGreaterThanOrEqual(0);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
      expect(box.y + box.height).toBeLessThanOrEqual(viewport.height);
    }

    const screenshotDir = process.env.QA_SCREENSHOT_DIR;
    if (screenshotDir) {
      fs.mkdirSync(screenshotDir, { recursive: true });
      await page.screenshot({ path: `${screenshotDir}/findings-export-light.png` });
      const themeToggle = page.locator('button[aria-label*="theme" i], button[title*="theme" i], button[title*="mode" i]').first();
      if (await themeToggle.isVisible()) {
        await themeToggle.click();
        await exportTrigger.click();
        await expect(menu).toBeVisible();
        await page.screenshot({ path: `${screenshotDir}/findings-export-dark.png` });
        await themeToggle.click();
        await exportTrigger.click();
        await expect(menu).toBeVisible();
      }
    }

    // Escape closes menu and restores focus to trigger
    await page.keyboard.press('Escape');
    await expect(menu).toBeHidden();
    await expect(exportTrigger).toBeFocused();

    // Re-open, select 1 example per finding, and download Grouped Findings (JSON)
    await exportTrigger.click();
    const btn1 = page.locator('.findings-export-example-btn', { hasText: '1' });
    await btn1.click();
    await expect(btn1).toHaveAttribute('aria-pressed', 'true');

    const jsonDownloadPromise = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: /Grouped Findings \(JSON\)/i }).click();
    await expect(menu).toBeHidden();
    const jsonDownload = await jsonDownloadPromise;
    expect(jsonDownload.suggestedFilename()).toMatch(/^swazz-findings-grouped-.*\.json$/);
    const jsonPath = await jsonDownload.path();
    expect(jsonPath).toBeTruthy();
    const parsed = JSON.parse(fs.readFileSync(jsonPath!, 'utf-8'));
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.format).toBe('swazz-grouped-findings');
    expect(parsed.maxExamplesPerFinding).toBe(1);
    expect(parsed.summary.totalGroups).toBeGreaterThan(0);
    expect(parsed.summary.exportedExamples).toBeGreaterThan(0);
    for (const group of [...parsed.securityVulnerabilities, ...parsed.infrastructureErrors]) {
      for (const target of group.targets) {
        expect(target.examples.length).toBe(1);
      }
    }

    // Re-open, select 2 examples per finding, and download Grouped Findings (Markdown)
    await exportTrigger.click();
    await page.locator('.findings-export-example-btn', { hasText: '2' }).click();
    const mdDownloadPromise = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: /Grouped Findings \(Markdown\)/i }).click();
    await expect(menu).toBeHidden();
    const mdDownload = await mdDownloadPromise;
    expect(mdDownload.suggestedFilename()).toMatch(/^swazz-findings-grouped-.*\.md$/);
    const mdPath = await mdDownload.path();
    expect(mdPath).toBeTruthy();
    const mdContent = fs.readFileSync(mdPath!, 'utf-8');
    expect(mdContent).toContain('# Swazz Grouped Findings Report');
    expect(mdContent).toContain('**Examples per Finding:** 2');
    expect(mdContent).toContain('## Security Vulnerabilities');
    expect(mdContent).toContain('## Infrastructure Errors');
    expect(mdContent).toContain('Example 1/');

    // Re-open and download Full Scan Log (JSON)
    await exportTrigger.click();
    const fullDownloadPromise = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: /Full Scan Log \(JSON\)/i }).click();
    await expect(menu).toBeHidden();
    const fullDownload = await fullDownloadPromise;
    expect(fullDownload.suggestedFilename()).toMatch(/^swazz-results-.*\.json$/);
    const fullPath = await fullDownload.path();
    expect(fullPath).toBeTruthy();
    const fullParsed = JSON.parse(fs.readFileSync(fullPath!, 'utf-8'));
    expect(Array.isArray(fullParsed.results)).toBe(true);
    expect(fullParsed.results.length).toBeGreaterThan(0);

    // Switch to Logs tab and confirm direct Export button works without a dropdown
    await page.locator('button.tab-bar-btn:has-text("Logs")').click();
    const logsExportBtn = page.getByRole('button', { name: /^Export$/i });
    await expect(logsExportBtn).toBeVisible();
    const logsDownloadPromise = page.waitForEvent('download');
    await logsExportBtn.click();
    const logsDownload = await logsDownloadPromise;
    expect(logsDownload.suggestedFilename()).toMatch(/^swazz-results-.*\.json$/);
    const logsPath = await logsDownload.path();
    expect(logsPath).toBeTruthy();
    const logsParsed = JSON.parse(fs.readFileSync(logsPath!, 'utf-8'));
    expect(Array.isArray(logsParsed.results)).toBe(true);
    expect(logsParsed.results.length).toBeGreaterThan(0);
    await expect(page.getByRole('menu')).toBeHidden();
  });
});
