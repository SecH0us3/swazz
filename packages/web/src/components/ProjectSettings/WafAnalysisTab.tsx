// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import React from 'react';
import { useConfig } from '../../hooks/useConfig.js';

export function WafAnalysisTab() {
    const { config, updateSettings } = useConfig();

    return (
        <div className="project-settings-section">
            <div className="project-settings-section-header">
                <h3 className="project-settings-section-title">WAF Analysis</h3>
                <p className="project-settings-section-subtitle">
                    Pre-scan domain fingerprinting and post-scan virtual patch generation.
                </p>
            </div>

            <div className="fuzz-setting-checkbox-group no-border">
                <label className="premium-checkbox-label">
                    <input
                        type="checkbox"
                        className="premium-checkbox"
                        checked={config?.settings?.waf_check_enabled ?? true}
                        onChange={(e) => updateSettings({ waf_check_enabled: e.target.checked })}
                    />
                    <strong className="fuzz-setting-label-bold">Enable Pre-Scan WAF Fingerprinting</strong>
                </label>
                <span className="fuzz-setting-checkbox-hint">
                    Probe the target domain prior to scanning to detect WAF vendor (Cloudflare, AWS, ModSecurity, etc.) and identify bypass opportunities.
                </span>
            </div>
        </div>
    );
}

