// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import React from 'react';
import { Logo } from './Common/Logo.js';
import { BLOG_URL, DOCS, REPO_URL } from '../utils/docsLinks.js';

export function AboutPage() {
    return (
        <div className="about-container">
            <div className="about-hero">
                <div className="about-logo-icon">
                    <Logo size={64} />
                </div>
                <h1 className="about-title">Swazz API Fuzzer</h1>
                <p className="about-subtitle">A high-performance smart fuzzer for REST, GraphQL, gRPC, WebSocket and MCP APIs.</p>
            </div>

            <div className="about-grid">
                <div className="about-card">
                    <h3 className="about-card-title">🎯 Smart Fuzzing</h3>
                    <p className="about-card-text">
                        Swazz parses Swagger/OpenAPI definitions to discover target endpoints, parameters, and authentication methods. It then automatically constructs fuzzed payloads targeting critical vulnerabilities.
                    </p>
                </div>

                <div className="about-card">
                    <h3 className="about-card-title">🔍 Detections</h3>
                    <ul className="about-card-list">
                        <li><strong>Reflected XSS</strong> — Unescaped input reflections in response payloads.</li>
                        <li><strong>SQL Injection Leaks</strong> — Raw database-specific SQL errors leaked in responses.</li>
                        <li><strong>Sensitive Data Leaks</strong> — Leaks of private keys, AWS secrets, internal IPs, or JWT tokens.</li>
                        <li><strong>Null Reference Detections</strong> — Stack traces and null pointer signatures.</li>
                    </ul>
                </div>

                <div className="about-card">
                    <h3 className="about-card-title">⚙️ Architecture</h3>
                    <p className="about-card-text">
                        Swazz operates on a decentralized, hybrid-cache architecture. Heavy fuzzer tasks run inside a sandboxed Go agent, communicating via WebSockets with an edge Durable Object coordinator and SQLite/D1 database.
                    </p>
                </div>

                <div className="about-card">
                    <h3 className="about-card-title">🛡️ Security & Privacy</h3>
                    <p className="about-card-text">
                        Scans run from runner agents you can host inside your own network: the target API is only ever contacted from the runner, so internal services never need to be exposed. The runner streams scan progress, findings and the request/response samples shown in the Inspector back to the coordinator.
                    </p>
                </div>
            </div>

            <div className="about-footer-info">
                <p className="about-footer-text">Swazz is open source and designed for modern, automated AppSec pipelines.</p>
                <div className="about-links">
                    <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="about-btn-link">GitHub Repository</a>
                    <a href={DOCS.home} target="_blank" rel="noopener noreferrer" className="about-btn-link">Documentation</a>
                    <a href={BLOG_URL} target="_blank" rel="noopener noreferrer" className="about-btn-link">Blog</a>
                </div>
            </div>
        </div>
    );
}
