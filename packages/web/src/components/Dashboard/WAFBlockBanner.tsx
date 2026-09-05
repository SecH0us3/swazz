// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import type { RunStats, FuzzingProfile } from '../../types.js';

// HTTP status codes a WAF typically returns when it blocks a request before it reaches the origin.
const WAF_BLOCK_CODES = [403, 406, 429];

// Attack profiles carry the malicious/edge payloads a WAF is meant to catch; RANDOM is the benign
// baseline. Comparing the two is what lets us honestly attribute blocking to the WAF (which reacts
// to payload content) rather than to authentication (which blocks every profile equally).
const ATTACK_PROFILES: FuzzingProfile[] = ['MALICIOUS', 'BOUNDARY'];
const BASELINE_PROFILE: FuzzingProfile = 'RANDOM';

// Warn only once attack traffic is being blocked heavily...
const ATTACK_BLOCK_THRESHOLD = 0.4;
// ...and clearly more than the benign baseline, so we can say it is the WAF and not auth. When
// there is no baseline profile in the scan we fall back to the threshold alone.
const WAF_SPECIFICITY_MARGIN = 0.25;

interface Props {
    stats: RunStats;
}

function totalsFor(
    statusByProfile: NonNullable<RunStats['statusByProfile']>,
    profiles: FuzzingProfile[]
): { total: number; blocked: number } {
    let total = 0;
    let blocked = 0;
    for (const p of profiles) {
        const counts = statusByProfile[p];
        if (!counts) continue;
        for (const [codeStr, n] of Object.entries(counts)) {
            total += n;
            if (WAF_BLOCK_CODES.includes(Number(codeStr))) blocked += n;
        }
    }
    return { total, blocked };
}

/**
 * Surfaces an honest "the WAF is eating your scan" signal. It fires only when a WAF was detected
 * pre-scan AND attack-profile traffic is blocked heavily AND markedly more than the benign baseline
 * — the profile gap is what distinguishes WAF payload-blocking from ordinary auth failures (which
 * would block every profile alike). Diagnostic only; it does not attempt to bypass anything.
 */
export function WAFBlockBanner({ stats }: Props) {
    if (!stats.wafCheck?.detection?.detected) return null;

    const statusByProfile = stats.statusByProfile;
    if (!statusByProfile) return null;

    const attack = totalsFor(statusByProfile, ATTACK_PROFILES);
    if (attack.total <= 0) return null;

    const attackRate = attack.blocked / attack.total;
    if (attackRate < ATTACK_BLOCK_THRESHOLD) return null;

    const baseline = totalsFor(statusByProfile, [BASELINE_PROFILE]);
    const baselineRate = baseline.total > 0 ? baseline.blocked / baseline.total : null;

    // WAF-attributable only when attack traffic is blocked distinctly more than benign traffic
    // (or when there is no baseline to compare against).
    const wafSpecific = baselineRate === null || attackRate - baselineRate >= WAF_SPECIFICITY_MARGIN;
    if (!wafSpecific) return null;

    const attackPct = Math.round(attackRate * 100);
    const wafType = stats.wafCheck.detection.wafType || 'A WAF';
    const baselineNote =
        baselineRate !== null ? `, versus ${Math.round(baselineRate * 100)}% of benign baseline traffic` : '';

    return (
        <div className="waf-block-banner" role="status" data-testid="waf-block-banner">
            <span className="waf-block-banner-icon" aria-hidden="true">🛡️</span>
            <div className="waf-block-banner-body">
                <div className="waf-block-banner-title">
                    {wafType} is blocking {attackPct}% of this scan's attack traffic
                </div>
                <div className="waf-block-banner-sub">
                    {attack.blocked.toLocaleString()} of {attack.total.toLocaleString()} malicious / boundary
                    payloads were stopped with WAF block codes (403 / 406 / 429){baselineNote}. The firewall is
                    intercepting the scan before it reaches your API — allowlist the scanner or run it against a
                    staging environment without the WAF to exercise the origin.
                </div>
            </div>
        </div>
    );
}
