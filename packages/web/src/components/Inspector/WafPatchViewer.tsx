// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import React, { useState } from 'react';
import type { WAFPatchReport } from '../../types.js';
import { tokenizeCode, type CodeLang } from '../../utils/syntaxHighlight.js';

interface WafPatchViewerProps {
    report?: WAFPatchReport | null;
}

const VENDOR_NAMES: Record<string, string> = {
    cloudflare: 'Cloudflare',
    aws: 'AWS',
    modsecurity: 'ModSecurity',
    nginx: 'nginx',
};

const VENDOR_RULE_TYPES: Record<string, string> = {
    cloudflare: 'Wirefilter',
    aws: 'AWS WAF JSON',
    modsecurity: 'SecRule',
    nginx: 'Nginx Config',
};

function formatVendorName(vendor: string): string {
    return VENDOR_NAMES[vendor.toLowerCase()] || vendor.toUpperCase();
}

function getNativeRuleLabel(vendor: string): string {
    const type = VENDOR_RULE_TYPES[vendor.toLowerCase()];
    return type ? `Native Rule (${type})` : 'Native Rule';
}

function nativeLang(vendor: string): CodeLang {
    return vendor.toLowerCase() === 'aws' ? 'json' : 'generic';
}

export function WafPatchViewer({ report }: WafPatchViewerProps) {
    if (!report || !report.bundles || Object.keys(report.bundles).length === 0) {
        return null;
    }

    const vendors = Object.keys(report.bundles);
    const [selectedVendor, setSelectedVendor] = useState<string>(vendors[0]);
    const [copiedNative, setCopiedNative] = useState(false);
    const [copiedTerraform, setCopiedTerraform] = useState(false);

    const activeVendor = vendors.includes(selectedVendor) ? selectedVendor : vendors[0];
    const currentBundle = report.bundles[activeVendor];

    const copyToClipboard = (text: string, isTerraform: boolean) => {
        if (!navigator?.clipboard?.writeText) return;
        navigator.clipboard.writeText(text).then(() => {
            if (isTerraform) {
                setCopiedTerraform(true);
                setTimeout(() => setCopiedTerraform(false), 2000);
            } else {
                setCopiedNative(true);
                setTimeout(() => setCopiedNative(false), 2000);
            }
        }).catch((err) => {
            console.error('Failed to copy: ', err);
        });
    };

    if (!currentBundle) {
        return null;
    }

    return (
        <div className="waf-rules-card" data-testid="waf-patch-viewer">
            <div className="waf-rules-header">
                <div>
                    <div className="waf-rules-title-group">
                        <span className="waf-rules-title-icon" aria-hidden="true">🛡️</span>
                        <span className="waf-rules-title">WAF Mitigation Rules</span>
                    </div>
                    <div className="waf-rules-sub">
                        Generated virtual patch rules for {report.totalBypasses} bypass{report.totalBypasses === 1 ? '' : 'es'}
                    </div>
                </div>
                <div className="waf-vendor-tabs" data-testid="waf-vendor-tabs">
                    {vendors.map((v) => (
                        <button
                            key={v}
                            type="button"
                            className={`waf-vendor-tab ${activeVendor === v ? 'active' : ''}`}
                            data-testid={`waf-vendor-tab-${v}`}
                            onClick={() => setSelectedVendor(v)}
                        >
                            {formatVendorName(v)}
                        </button>
                    ))}
                </div>
            </div>

            <div className="waf-rules-body">
                {currentBundle.native && (
                    <div>
                        <div className="waf-code-block-header">
                            <span className="waf-code-block-label">{getNativeRuleLabel(activeVendor)}</span>
                        </div>
                        <div className="detail-json-wrapper">
                            <pre
                                data-testid="waf-patch-native"
                                className="waf-code-block detail-json-with-action"
                            >
                                {tokenizeCode(currentBundle.native, nativeLang(activeVendor)).map((tok, i) =>
                                    tok.className
                                        ? <span key={i} className={tok.className}>{tok.text}</span>
                                        : <React.Fragment key={i}>{tok.text}</React.Fragment>
                                )}
                            </pre>
                            <button
                                type="button"
                                className="btn btn-ghost btn-xs response-copy-btn"
                                data-testid="copy-native-btn"
                                onClick={() => copyToClipboard(currentBundle.native, false)}
                            >
                                {copiedNative ? '✓ Copied' : 'Copy'}
                            </button>
                        </div>
                    </div>
                )}

                {currentBundle.terraform && (
                    <div>
                        <div className="waf-code-block-header">
                            <span className="waf-code-block-label">Terraform HCL</span>
                        </div>
                        <div className="detail-json-wrapper">
                            <pre
                                data-testid="waf-patch-terraform"
                                className="waf-code-block detail-json-with-action"
                            >
                                {tokenizeCode(currentBundle.terraform, 'generic').map((tok, i) =>
                                    tok.className
                                        ? <span key={i} className={tok.className}>{tok.text}</span>
                                        : <React.Fragment key={i}>{tok.text}</React.Fragment>
                                )}
                            </pre>
                            <button
                                type="button"
                                className="btn btn-ghost btn-xs response-copy-btn"
                                data-testid="copy-terraform-btn"
                                onClick={() => copyToClipboard(currentBundle.terraform!, true)}
                            >
                                {copiedTerraform ? '✓ Copied' : 'Copy'}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
