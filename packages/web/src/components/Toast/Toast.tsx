// Copyright (c) 2026 Swazz Authors
// This file is part of Swazz
// Swazz is licensed under the Business Source License 1.1 (BSL 1.1)
// See the LICENSE file in the project root or visit https://github.com/SecH0us3/swazz for more details



import { useEffect } from 'react';

export interface ToastData {
    id: number;
    message: string;
    type: 'info' | 'success' | 'error';
}

export function Toast({ message, type, onDismiss }: { message: string; type: string; onDismiss: () => void }) {
    useEffect(() => {
        if (type !== 'error') {
            const timer = setTimeout(onDismiss, 5000);
            return () => clearTimeout(timer);
        }
    }, [type, onDismiss]);

    const borderColor =
        type === 'error' ? 'var(--color-error)' :
            type === 'success' ? 'var(--color-success)' :
                'var(--color-info)';

    return (
        <div className="toast" style={{ borderLeft: `3px solid ${borderColor}` }} onClick={onDismiss} title="Click to dismiss">
            {message}
        </div>
    );
}
