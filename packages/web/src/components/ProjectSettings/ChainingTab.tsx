// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import React from 'react';
import { useConfig } from '../../hooks/useConfig.js';
import { ChainingRulesEditor } from '../Sidebar/ChainingRulesEditor.js';

export function ChainingTab() {
    const { config, updateSettings } = useConfig();

    return (
        <div className="card chaining-tab-card">
            <h2 className="chaining-tab-title">
                Request Chaining Rules
            </h2>
            <p className="chaining-tab-desc">
                Configure chaining rules to extract dynamic variables (like CSRF tokens or session IDs) from responses and inject them into subsequent test requests.
            </p>

            <div className="fuzz-setting-section">
                <div className="fuzz-setting-checkbox-group no-border">
                    <label className="premium-checkbox-label">
                        <input
                            type="checkbox"
                            className="premium-checkbox"
                            checked={config.settings.enable_auto_chaining !== false}
                            onChange={(e) => updateSettings({ enable_auto_chaining: e.target.checked })}
                        />
                        <strong className="fuzz-setting-label-bold">Automatic Request Chaining (DAG)</strong>
                    </label>
                    <span className="fuzz-setting-checkbox-hint">
                        Automatically order producer → consumer endpoints, harvest live IDs &amp; Location headers, and isolate destructive DELETE calls. Manual rules below always take precedence.
                    </span>
                </div>
            </div>

            <div className="alert-banner alert-info">
                <div className="alert-banner-header">Tip</div>
                <div className="alert-banner-message">
                    Ask the AI assistant to help you write the request chaining rules — it will be much easier.
                </div>
            </div>
            <ChainingRulesEditor
                rules={config.settings.chaining_rules || []}
                onChange={(rules) => updateSettings({ chaining_rules: rules })}
            />
        </div>
    );
}
