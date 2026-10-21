// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import React from 'react';
import { RESOURCE_LINKS } from '../../utils/docsLinks.js';
import './DocsLink.css';

export function ExternalLinkIcon({ size = 11 }: { size?: number }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
            <polyline points="15 3 21 3 21 9"></polyline>
            <line x1="10" y1="14" x2="21" y2="3"></line>
        </svg>
    );
}

interface DocsLinkProps {
    href: string;
    /** Visible text. Without it the link renders as a compact "?" icon. */
    label?: string;
    /** Tooltip and accessible name; defaults to the label. */
    title?: string;
}

/** A link to the documentation site that always opens in a new tab. */
export function DocsLink({ href, label, title }: DocsLinkProps) {
    const name = title || label || 'Open documentation';
    if (!label) {
        return (
            <a href={href} target="_blank" rel="noopener noreferrer" className="docs-help-icon" title={name} aria-label={name}>
                ?
            </a>
        );
    }
    return (
        <a href={href} target="_blank" rel="noopener noreferrer" className="docs-link" title={name}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path>
                <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>
            </svg>
            <span>{label}</span>
            <ExternalLinkIcon />
        </a>
    );
}

/** Documentation, repository, blog and issue links shown under a settings navigation list. */
export function SettingsResourceLinks() {
    return (
        <nav className="settings-resource-links" aria-label="Help and resources">
            <div className="settings-resource-links-title">Help & resources</div>
            {RESOURCE_LINKS.map(link => (
                <a key={link.href} href={link.href} target="_blank" rel="noopener noreferrer" className="settings-resource-link">
                    <span>{link.label}</span>
                    <ExternalLinkIcon />
                </a>
            ))}
        </nav>
    );
}
