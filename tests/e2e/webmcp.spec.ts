// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import { test, expect } from '@playwright/test';
import { registerAndLogin } from './helpers';

test.describe('Client-Side WebMCP Dashboard Tools', () => {
  test('should expose Swazz WebMCP tools and allow driving UI state via page.webmcp', async ({ page }) => {
    await registerAndLogin(page, 'wmcp');

    const tools = await page.webmcp.tools();
    const toolNames = tools.map((t: { name: string }) => t.name).sort();
    expect(toolNames).toEqual([
      'swazz_ui_configure_scan',
      'swazz_ui_filter_heatmap',
      'swazz_ui_get_active_state',
      'swazz_ui_start_scan',
      'swazz_ui_switch_tab',
    ]);

    // 1. Read active state
    const stateRes: any = await page.webmcp.callTool('swazz_ui_get_active_state', {});
    const initialState = JSON.parse(stateRes.content[0].text);
    expect(initialState.activeTab).toBe('heatmap');
    expect(initialState.isRunning).toBe(false);

    // 2. Configure scan via WebMCP without clicking sidebar inputs
    const cfgRes: any = await page.webmcp.callTool('swazz_ui_configure_scan', {
      baseUrl: 'http://localhost:8788',
      profiles: ['RANDOM', 'MALICIOUS'],
    });
    const cfgData = JSON.parse(cfgRes.content[0].text);
    expect(cfgData.baseUrl).toBe('http://localhost:8788');
    expect(cfgData.profiles).toEqual(['RANDOM', 'MALICIOUS']);

    // 3. Switch tab via WebMCP and verify DOM updates
    await page.webmcp.callTool('swazz_ui_switch_tab', { tab: 'waf' });
    const afterSwitch: any = await page.webmcp.callTool('swazz_ui_get_active_state', {});
    expect(JSON.parse(afterSwitch.content[0].text).activeTab).toBe('waf');

    // 4. Verify fail-closed validation on invalid input
    const badRes: any = await page.webmcp.callTool('swazz_ui_configure_scan', {
      baseUrl: 'javascript:alert(1)',
    });
    expect(badRes.isError).toBe(true);
  });
});
