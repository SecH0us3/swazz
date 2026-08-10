// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import type { Tip } from '../../data/tips.js';
import './DidYouKnowToast.css';

export function DidYouKnowToast({ tip, onDismiss }: { tip: Tip; onDismiss: () => void }) {
    return (
        <div className="dyd-toast" role="status" aria-live="polite">
            <div className="dyd-toast-head">
                <span className="dyd-toast-emoji" aria-hidden="true">💡</span>
                <span className="dyd-toast-title">Did you know / А знаете ли вы...</span>
            </div>
            <div className="dyd-toast-body">
                <strong className="dyd-toast-tip-title">{tip.title}</strong>
                <p className="dyd-toast-summary">{tip.summary}</p>
            </div>
            <div className="dyd-toast-actions">
                {tip.docsUrl && (
                    <a className="dyd-toast-link" href={tip.docsUrl} target="_blank" rel="noopener noreferrer">Documentation</a>
                )}
                <button type="button" className="dyd-toast-dismiss" onClick={onDismiss}>Понятно / I know</button>
            </div>
        </div>
    );
}
