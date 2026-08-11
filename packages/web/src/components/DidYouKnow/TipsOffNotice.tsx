// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details

import './TipsOffNotice.css';

export function TipsOffNotice({ onOpenSettings }: { onOpenSettings: () => void }) {
    return (
        <div className="dyd-off" role="status" aria-live="polite">
            <span className="dyd-off-text">Tips are off — enable them in Settings</span>
            <button type="button" className="dyd-off-action" onClick={onOpenSettings}>Settings</button>
        </div>
    );
}
