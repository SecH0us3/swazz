

export interface ToastData {
    id: number;
    message: string;
    type: 'info' | 'success' | 'error';
}

export function Toast({ message, type, onDismiss }: { message: string; type: string; onDismiss: () => void }) {
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
