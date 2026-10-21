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
    webUi: docsUrl('usage', 'web-ui'),
    configFile: docsUrl('usage', 'configuration-file'),
    specFormats: docsUrl('usage', 'spec-formats'),
    authSequence: docsUrl('usage', 'auth-sequence'),
    requestChaining: docsUrl('usage', 'request-chaining'),
    suppressions: docsUrl('usage', 'suppressions'),
    uiPerformance: docsUrl('usage', 'ui-performance'),
    wafAnalysis: docsUrl('usage', 'waf-analysis'),
    accountDeletion: docsUrl('usage', 'account-deletion'),
    projectSettings: docsUrl('usage', 'project-settings'),
    membersRoles: docsUrl('usage', 'members-roles'),
    scanScheduler: docsUrl('usage', 'scan-scheduler'),
    auditTrail: docsUrl('usage', 'audit-trail'),
    recipes: docsUrl('recipes'),
    bolaMultiIdentity: docsUrl('recipes', 'bola-multi-identity'),
    deployment: docsUrl('deployment'),
    runnerSetup: docsUrl('deployment', 'runner-agent-setup'),
    runnerSandboxing: docsUrl('runner_sandboxing_guide'),
    kubernetes: docsUrl('kubernetes'),
    ciCd: docsUrl('ci_cd'),
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
