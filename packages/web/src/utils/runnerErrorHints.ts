// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

// What the user can change when a scan fails or warns: known runner messages mapped to a plain
// suggestion and, where one exists, the place in the dashboard to change it.

export type HintTab = 'project_settings' | 'settings' | 'runner_logs';

export interface RunnerHint {
    text: string;
    action?: { label: string; tab: HintTab };
}

const PROJECT_SETTINGS = { label: 'Open Project Settings', tab: 'project_settings' as const };
const RUNNER_SETTINGS = { label: 'Open Settings', tab: 'settings' as const };

const RULES: Array<{ test: RegExp; hint: RunnerHint }> = [
    {
        test: /\bMCP\b.*\b(401|403|unauthori[sz]ed|forbidden)\b/i,
        hint: {
            text: 'The MCP server configured for this project rejected the runner. Add the MCP server\'s token in Global Headers, or remove the MCP server from Project Settings if it should not be scanned.',
            action: PROJECT_SETTINGS,
        },
    },
    {
        test: /\bMCP server\b/i,
        hint: {
            text: 'The MCP server configured for this project could not be used. Check its URL and credentials, or remove it from Project Settings if it should not be scanned.',
            action: PROJECT_SETTINGS,
        },
    },
    {
        test: /stopped responding|no runner took|no runners? (connected|available)/i,
        hint: {
            text: 'No runner was available to finish the scan. Check that a runner is connected, then start the scan again.',
            action: RUNNER_SETTINGS,
        },
    },
    {
        test: /re-?authentication failed|login (flow|request) failed|auth(entication)? flow/i,
        hint: {
            text: 'Logging in to the target failed, so requests may be rejected. Check the authentication settings of the project.',
            action: PROJECT_SETTINGS,
        },
    },
    {
        test: /cannot start scan|no (active )?endpoints|import an openapi/i,
        hint: {
            text: 'The scan has nothing to scan. Import an OpenAPI/Swagger spec or select endpoints, then start it again.',
        },
    },
    {
        test: /private (ip|network|address)|blocked .*(private|internal|reserved)/i,
        hint: {
            text: 'The target resolves to a private address, which shared runners may not reach. Scan it with your own runner.',
            action: RUNNER_SETTINGS,
        },
    },
];

/** The hint for a runner message, if one is known. */
export function hintForRunnerMessage(message: string): RunnerHint | null {
    for (const rule of RULES) {
        if (rule.test.test(message)) return rule.hint;
    }
    return null;
}
