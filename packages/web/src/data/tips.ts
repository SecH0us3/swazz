// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

export interface Tip {
    id: string;
    title: string;
    summary: string;
    docsUrl?: string;
}

export const TIPS: Tip[] = [
    {
        id: 'disable-active-param-fuzzing',
        title: 'Disable Active Parameter Fuzzing for fast scans',
        summary: 'Active parameter fuzzing mutates every parameter with a large payload corpus, which can dramatically slow down a scan. Disable it when you only need a quick structural or pass-through check of an endpoint. Re-enable it for deep coverage when time allows.',
        docsUrl: 'https://sech0us3.github.io/swazz/usage.html#ui-performance-optimization',
    },
    {
        id: 'auth-headers',
        title: 'Authenticate your scans',
        summary: 'Add your bearer token, API key, or session cookie so Swazz can exercise authenticated endpoints instead of skipping them as unauthorized. An unauthenticated scan only covers public surface area. Configure headers once per scan to reach protected routes.',
        docsUrl: 'https://sech0us3.github.io/swazz/usage.html#authentication-sequences--variable-evaluation',
    },
    {
        id: 'rate-limiting',
        title: 'Mind the rate limits',
        summary: 'Fuzzing sends many concurrent requests and can trip rate limiters on the target or get you blocked. Reduce concurrency and add delays between requests for production targets. Respect the target API\'s documented rate policy to keep scans reliable.',
        docsUrl: 'https://sech0us3.github.io/swazz/usage.html#configuration-file-swazzconfigjson',
    },
    {
        id: 'enable-2fa',
        title: 'Secure your Swazz account',
        summary: 'Enable two-factor authentication to protect your Swazz account and the stored scan configurations. 2FA prevents unauthorized access even if your credentials are leaked. Add a passkey or authenticator app in your account settings.',
        docsUrl: 'https://sech0us3.github.io/swazz/usage.html',
    },
    {
        id: 'custom-wordlists',
        title: 'Bring your own wordlists',
        summary: 'Swazz ships with default payloads, but you can supply your own wordlists tuned to your API\'s domain. Custom lists improve detection of application-specific injection points. Load them via the scan configuration to override the built-in corpus.',
        docsUrl: 'https://sech0us3.github.io/swazz/usage.html#configuration-file-swazzconfigjson',
    },
    {
        id: 'bola-testing',
        title: 'Detect BOLA (IDOR)',
        summary: 'Broken Object Level Authorization lets attackers access objects by changing IDs in requests. Swazz mutates path and query parameters to probe for unauthorized access to other resources. Review BOLA findings to confirm you are enforcing per-object authorization checks.',
        docsUrl: 'https://sech0us3.github.io/swazz/recipes.html#recipe-2-detecting-bola-idor-with-multi-identity',
    },
    {
        id: 'schedule-scans',
        title: 'Schedule recurring scans',
        summary: 'Automate regular scans so your API is continuously checked against new vulnerabilities as it changes. Recurring scans catch regressions and newly introduced weaknesses between manual review cycles. Set a cadence that matches your release frequency.',
        docsUrl: 'https://sech0us3.github.io/swazz/ci_cd.html',
    },
    {
        id: 'chaining-rules',
        title: 'Chain multi-step attacks',
        summary: 'Some vulnerabilities only appear when multiple requests are combined into a single attack flow. Use chaining rules to sequence requests that build on each other, such as login followed by privilege escalation. Multi-step chains reveal logic flaws a single request misses.',
        docsUrl: 'https://sech0us3.github.io/swazz/usage.html#authentication-sequences--variable-evaluation',
    },
    {
        id: 'webhooks',
        title: 'Get alerted on findings',
        summary: 'Configure webhooks so Swazz pushes notifications to your chat or ticketing system the moment a finding is detected. Instant alerts let your team respond before an issue is exploited. Add your endpoint URL and select which severities trigger a notification.',
        docsUrl: 'https://sech0us3.github.io/swazz/webhooks.html#configuration',
    },
    {
        id: 'rotate-api-keys',
        title: 'Rotate your API keys',
        summary: 'Fuzz payloads and scan reports can expose secrets such as API keys. Rotate keys that appear in findings and never commit them to source control. Regular rotation limits the blast radius if a key is leaked during a scan.',
        docsUrl: 'https://sech0us3.github.io/swazz/usage.html',
    },
    {
        id: 'response-anomaly-tuning',
        title: 'Tune response anomaly detection',
        summary: 'Swazz flags responses whose size or structure differs dramatically from the baseline to surface potential issues. Tune the sensitivity thresholds to filter out noisy benign responses. Tight thresholds focus your attention on genuinely anomalous behavior.',
        docsUrl: 'https://sech0us3.github.io/swazz/usage.html#configuration-file-swazzconfigjson',
    },
];
