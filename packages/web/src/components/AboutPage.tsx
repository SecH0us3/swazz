import React from 'react';

export function AboutPage() {
    return (
        <div className="about-container">
            <div className="about-hero">
                <div className="about-logo-icon">⚡</div>
                <h1 className="about-title">Swazz API Fuzzer</h1>
                <p className="about-subtitle">A high-performance smart fuzzer for REST APIs and OpenAPI specifications.</p>
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
                        Scans run from isolated agent nodes. Only high-level vulnerability metrics and metadata are sent back to the central edge coordinator, keeping application traffic and sensitive data securely within your private VPC or perimeter.
                    </p>
                </div>
            </div>

            <div className="about-footer-info">
                <p className="about-footer-text">Swazz is open source and designed for modern, automated AppSec pipelines.</p>
                <div className="about-links">
                    <a href="https://github.com/SecH0us3/swazz" target="_blank" rel="noopener noreferrer" className="about-btn-link">GitHub Repository</a>
                    <a href="https://sech0us3.github.io/swazz/" target="_blank" rel="noopener noreferrer" className="about-btn-link">Documentation</a>
                </div>
            </div>
        </div>
    );
}
