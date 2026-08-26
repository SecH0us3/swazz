// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import React, { useState } from 'react';
import { useAppStore } from '../../store/appStore.js';

const PROXY_URL = (import.meta.env.VITE_PROXY_URL || '').replace(/\/$/, '');

export function McpTab() {
    const userProfile = useAppStore(state => state.userProfile);
    const apiBaseUrl = PROXY_URL || window.location.origin;
    const [copiedApiKey, setCopiedApiKey] = useState(false);

    const apiKey = userProfile?.apiKey || '';
    const displayKeyForSetup = !apiKey || apiKey.includes('•') ? '<YOUR_API_KEY>' : apiKey;

    const copyToClipboard = (text: string, setCopied: (v: boolean) => void) => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="settings-card">
            <h2 className="settings-card-title">
                Model Context Protocol (MCP) Integration
            </h2>
            <p className="settings-card-desc mcp-desc-spacing">
                Connect your local AI assistant (like Claude Desktop, Cursor, or Google Antigravity CLI) directly to your Swazz instance.
            </p>

            <div className="settings-form-group">
                <label className="settings-form-label">Your API Key (Password / Token)</label>
                <div className="settings-input-row mcp-key-row">
                    <input 
                        type="text" 
                        className="input settings-input-monospace" 
                        value={apiKey || 'swazz_live_••••••••••••••••••••••••'} 
                        readOnly 
                        data-1p-ignore
                    />
                    <button 
                        className="btn btn-secondary btn-sm settings-btn-min-w"
                        onClick={() => copyToClipboard(apiKey, setCopiedApiKey)}
                        disabled={!apiKey || apiKey.includes('•')}
                    >
                        {copiedApiKey ? '✓ Copied' : 'Copy'}
                    </button>
                </div>
                {!userProfile?.isGuest && (!apiKey || apiKey.includes('•')) && (
                    <p className="api-key-new-warning mcp-warning-text">
                        * Note: API keys are masked for security. If you do not have your plain-text key saved, please go to the <strong>Account Details</strong> tab and click <strong>Regenerate API Key</strong>.
                    </p>
                )}
            </div>

            <div className="mcp-section-wrapper">
                <h3 className="settings-card-subtitle mcp-subtitle">
                    1. Claude Desktop Setup
                </h3>
                <p className="settings-card-desc mcp-step-desc">
                    The easiest way to register the Swazz MCP server using the <code>claude</code> CLI:
                </p>
                <pre className="log-payload-preview mcp-code-preview">
                    {`claude mcp add --transport sse swazz-cloud ${apiBaseUrl}/api/mcp/sse \\
  --header "Authorization: Bearer ${displayKeyForSetup}"`}
                </pre>

                <p className="settings-card-desc mcp-step-desc">
                    Or manually add this to your <code>claude_desktop_config.json</code>:
                </p>
                <pre className="log-payload-preview mcp-code-preview">
                    {JSON.stringify({
                        mcpServers: {
                            "swazz-cloud": {
                                type: "sse",
                                url: `${apiBaseUrl}/api/mcp/sse`,
                                headers: {
                                    Authorization: `Bearer ${displayKeyForSetup}`
                                }
                            }
                        }
                    }, null, 2)}
                </pre>
            </div>

            <div className="mcp-section-wrapper">
                <h3 className="settings-card-subtitle mcp-subtitle">
                    2. Google Antigravity (AGY) Setup
                </h3>
                <p className="settings-card-desc mcp-step-desc">
                    Add the Swazz MCP server to your global configuration file <code>~/.gemini/config/mcp_config.json</code> (or project-level <code>.agents/mcp_config.json</code>):
                </p>
                <pre className="log-payload-preview mcp-code-preview">
                    {JSON.stringify({
                        mcpServers: {
                            "swazz-cloud": {
                                serverUrl: `${apiBaseUrl}/api/mcp/sse`,
                                headers: {
                                    Authorization: `Bearer ${displayKeyForSetup}`
                                }
                            }
                        }
                    }, null, 2)}
                </pre>

                <p className="settings-card-desc mcp-step-desc">
                    Or configure programmatically from your terminal in one command:
                </p>
                <pre className="log-payload-preview mcp-code-preview">
                    {`node -e '
const fs = require("fs");
const path = require("path");
const filePath = path.join(process.env.HOME, ".gemini/config/mcp_config.json");
let config = { mcpServers: {} };
try { config = JSON.parse(fs.readFileSync(filePath, "utf8")); } catch {}
config.mcpServers["swazz-cloud"] = {
  serverUrl: "${apiBaseUrl}/api/mcp/sse",
  headers: { Authorization: "Bearer ${displayKeyForSetup}" }
};
fs.mkdirSync(path.dirname(filePath), { recursive: true });
fs.writeFileSync(filePath, JSON.stringify(config, null, 2));
console.log("Successfully added Swazz Cloud MCP to Google Antigravity!");
'`}
                </pre>
            </div>
        </div>
    );
}
