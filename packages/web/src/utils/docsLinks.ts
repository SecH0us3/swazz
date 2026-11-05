// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

// Every link from the dashboard to the documentation site is built here, so a
// moved page or renamed anchor is fixed in one place. Anchors are the explicit
// `{#id}` ids set on the headings in docs/*.md, not VitePress's generated slugs
// (those include emoji and change whenever a heading is reworded).

export const DOCS_URL = 'https://sech0us3.github.io/swazz/';
export const REPO_URL = 'https://github.com/SecH0us3/swazz';
export const ISSUES_URL = `${REPO_URL}/issues`;
export const BLOG_URL = 'https://yoursec.substack.com/t/swazz';

export function docsUrl(page: string, anchor?: string): string {
    return `${DOCS_URL}${page}.html${anchor ? `#${anchor}` : ''}`;
}

export const DOCS = {
    home: DOCS_URL,
    installation: docsUrl('installation'),
    runnerAgent: docsUrl('installation', 'runner-agent'),
    usage: docsUrl('usage'),
    configFile: docsUrl('usage', 'configuration-file'),
    projectSettings: docsUrl('usage', 'project-settings'),
    specFormats: docsUrl('usage', 'spec-formats'),
    harFuzzing: docsUrl('usage', 'har'),
    postman: docsUrl('usage', 'postman'),
    graphql: docsUrl('usage', 'graphql'),
    suppressions: docsUrl('usage', 'suppressions'),
    authSequence: docsUrl('usage', 'auth-sequence'),
    requestChaining: docsUrl('usage', 'request-chaining'),
    uiPerformance: docsUrl('usage', 'ui-performance'),
    wafAnalysis: docsUrl('usage', 'waf-analysis'),
    accountDeletion: docsUrl('usage', 'account-deletion'),
    membersRoles: docsUrl('usage', 'members-roles'),
    scanScheduler: docsUrl('usage', 'scan-scheduler'),
    auditTrail: docsUrl('usage', 'audit-trail'),
    activeRunners: docsUrl('usage', 'active-runners'),
    bolaMultiIdentity: docsUrl('recipes', 'bola-multi-identity'),
    mcpServerFuzzing: docsUrl('recipes', 'mcp-servers'),
    runnerSetup: docsUrl('deployment', 'runner-agent-setup'),
    runnerSandboxing: docsUrl('runner_sandboxing_guide'),
    kubernetes: docsUrl('kubernetes'),
    webhooks: docsUrl('webhooks'),
    webhooksConfig: docsUrl('webhooks', 'configuration'),
    mcp: docsUrl('mcp'),
    aiRemediation: docsUrl('ai_remediation'),
    browserExtension: docsUrl('browser_extension'),
    encryptionKeys: docsUrl('encryption_backup'),
    logging: docsUrl('logging'),
    pricing: docsUrl('PRICING'),
    securityReview: docsUrl('security_review'),
} as const;

/** The general help links offered in the account menu and under the settings navigation. */
export const RESOURCE_LINKS = [
    { href: DOCS.home, label: 'Documentation' },
    { href: REPO_URL, label: 'GitHub' },
    { href: BLOG_URL, label: 'Blog' },
    { href: ISSUES_URL, label: 'Report an issue' },
] as const;
