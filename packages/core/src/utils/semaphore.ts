/**
 * Lightweight semaphore for concurrency control — avoids busy-wait polling.
 * Waiters are queued and resolved in FIFO order as slots become available.
 */
export class Semaphore {
    private _available: number;
    private _waiters: Array<() => void> = [];

    constructor(concurrency: number) {
        this._available = concurrency;
    }

    async acquire(): Promise<void> {
        if (this._available > 0) {
            this._available--;
            return;
        }
        await new Promise<void>((resolve) => this._waiters.push(resolve));
    }

    release(): void {
        const next = this._waiters.shift();
        if (next) {
            next();
        } else {
            this._available++;
        }
    }
}
