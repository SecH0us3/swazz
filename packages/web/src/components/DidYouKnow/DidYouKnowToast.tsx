// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import type { Tip } from '../../data/tips.js';
import './DidYouKnowToast.css';

export function DidYouKnowToast({ tip, onDismiss, onDisable }: { tip: Tip; onDismiss: () => void; onDisable: () => void }) {
    return (
        <div className="dyd-tip" role="status" aria-live="polite">
            <button
                type="button"
                className="dyd-tip-close"
                onClick={onDisable}
                title="Turn off tips"
                aria-label="Turn off tips"
            >
                ×
            </button>
            <div className="dyd-tip-head">
                <span className="dyd-tip-icon" aria-hidden="true">💡</span>
                <span className="dyd-tip-eyebrow">Did you know</span>
            </div>
            <div className="dyd-tip-body">
                <strong className="dyd-tip-title">{tip.title}</strong>
                <p className="dyd-tip-summary">{tip.summary}</p>
            </div>
            <div className="dyd-tip-actions">
                {tip.docsUrl && (
                    <a className="dyd-tip-link" href={tip.docsUrl} target="_blank" rel="noopener noreferrer">Learn more</a>
                )}
                <button type="button" className="dyd-tip-ok" onClick={onDismiss}>OK</button>
            </div>
        </div>
    );
}
