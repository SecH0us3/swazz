export function getStatusClass(status: number): string {
    if (status >= 500 || status === 0) return 'status-5xx';
    if (status >= 400) return 'status-4xx';
    return '';
}

export function getBadgeClass(status: number): string {
    if (status >= 500 || status === 0) return 'badge badge-error';
    if (status >= 400) return 'badge badge-warning';
    if (status >= 200 && status < 300) return 'badge badge-success';
    return 'badge';
}

export function formatBytes(bytes: number): string {
    if (bytes === 0 || !bytes) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export function formatTime(ts: number): string {
    const d = new Date(ts);
    return d.toLocaleTimeString('en-US', { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
}

export function formatIdentityName(name: string): string {
    const lower = name.toLowerCase();
    if (lower === 'user a') return 'User A (Primary)';
    if (lower === 'user b') return 'User B';
    if (lower === 'anonymous') return 'Anonymous';
    if (name.length === 5 && lower.startsWith('user')) {
        return 'User ' + name.charAt(4).toUpperCase();
    }
    return name;
}
