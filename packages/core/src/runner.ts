/**
 * FuzzRunner — orchestrates fuzzing runs across endpoints × profiles × iterations.
 * Framework-agnostic: works in browser and Node.js via SendRequestFn callback.
 */

import type {
    SwazzConfig,
    SendRequestFn,
    FuzzResult,
    RunStats,
    FuzzingProfile,
} from './types.js';
import { SmartPayloadGenerator } from './generator.js';
import { uuid } from './random.js';

export class FuzzRunner {
    private config: SwazzConfig;
    private sendRequest: SendRequestFn;
    private _isRunning = false;
    private _isPaused = false;
    private _shouldStop = false;
    private _stats: RunStats;
    private _results: FuzzResult[] = [];

    // ─── Callbacks ──────────────────────────────────────────

    public onResult: (result: FuzzResult) => void = () => { };
    public onProgress: (stats: RunStats) => void = () => { };
    public onComplete: (stats: RunStats) => void = () => { };
    public onError: (error: Error) => void = () => { };

    constructor(config: SwazzConfig, sendRequest: SendRequestFn) {
        this.config = config;
        this.sendRequest = sendRequest;
        this._stats = this.createEmptyStats();
    }

    // ─── Control ────────────────────────────────────────────

    public async start(): Promise<void> {
        if (this._isRunning) return;

        this._isRunning = true;
        this._isPaused = false;
        this._shouldStop = false;
        this._stats = this.createEmptyStats();
        this._results = [];

        const { endpoints, settings, dictionaries, global_headers, cookies, base_url } = this.config;
        const profiles = settings.profiles;
        const iterations = settings.iterations_per_profile;
        const concurrency = settings.concurrency;
        const delay = settings.delay_between_requests_ms;

        try {
            for (const endpoint of endpoints) {
                if (this._shouldStop) break;

                // Determine if endpoint has fields to fuzz
                const hasFields = endpoint.schema?.properties &&
                    Object.keys(endpoint.schema.properties).length > 0;
                const isBodyMethod = !['GET', 'HEAD', 'DELETE', 'OPTIONS'].includes(
                    endpoint.method.toUpperCase(),
                );

                for (const profile of profiles) {
                    if (this._shouldStop) break;

                    // Smart iteration count:
                    // - No schema fields → 1 request (payload is always {} or empty)
                    // - Has fields → full iterations (each generates different payload)
                    const effectiveIterations = hasFields ? iterations : 1;

                    const generator = new SmartPayloadGenerator(dictionaries, profile);

                    // Process iterations with concurrency control
                    const tasks: Promise<void>[] = [];
                    let activeCount = 0;

                    for (let i = 0; i < effectiveIterations; i++) {
                        if (this._shouldStop) break;

                        // Wait while paused
                        while (this._isPaused && !this._shouldStop) {
                            await this.sleep(100);
                        }
                        if (this._shouldStop) break;

                        // Concurrency limiter
                        while (activeCount >= concurrency) {
                            await this.sleep(10);
                        }

                        activeCount++;
                        const taskPromise = (async () => {
                            try {
                                // Only generate body for methods that accept it
                                const payload = (hasFields && isBodyMethod)
                                    ? generator.buildObject(endpoint.schema)
                                    : undefined;

                                const result = await this.executeRequest(
                                    base_url,
                                    endpoint.path,
                                    endpoint.method,
                                    global_headers,
                                    cookies,
                                    payload,
                                    profile,
                                );

                                this._results.push(result);
                                this.updateStats(result);
                                this.onResult(result);
                                this.onProgress(this._stats);
                            } catch (err) {
                                const error = err instanceof Error ? err : new Error(String(err));
                                this.onError(error);
                            } finally {
                                activeCount--;
                            }
                        })();

                        tasks.push(taskPromise);

                        // Delay between requests
                        if (delay > 0) {
                            await this.sleep(delay);
                        }
                    }

                    // Wait for remaining tasks in this profile batch
                    await Promise.all(tasks);
                }
            }
        } finally {
            this._isRunning = false;
            this._stats.isRunning = false;
            this.onComplete(this._stats);
        }
    }

    public stop(): void {
        this._shouldStop = true;
        this._isPaused = false;
    }

    public pause(): void {
        if (this._isRunning) {
            this._isPaused = true;
        }
    }

    public resume(): void {
        this._isPaused = false;
    }

    public get isRunning(): boolean {
        return this._isRunning;
    }

    public get isPaused(): boolean {
        return this._isPaused;
    }

    public getStats(): RunStats {
        return { ...this._stats };
    }

    public getResults(): FuzzResult[] {
        return [...this._results];
    }

    // ─── Private ────────────────────────────────────────────

    private async executeRequest(
        baseUrl: string,
        path: string,
        method: string,
        headers: Record<string, string>,
        cookies: Record<string, string>,
        payload: any,
        profile: FuzzingProfile,
    ): Promise<FuzzResult> {
        const url = baseUrl.replace(/\/$/, '') + path;

        // Build final headers: user headers take precedence.
        // Auto-inject Content-Type: application/json for body requests unless user already set one.
        const isBodyMethod = !['GET', 'HEAD', 'DELETE', 'OPTIONS'].includes(method.toUpperCase());
        const hasContentType = Object.keys(headers).some(
            (k) => k.toLowerCase() === 'content-type',
        );
        const finalHeaders: Record<string, string> = {
            ...(isBodyMethod && payload !== undefined && !hasContentType
                ? { 'Content-Type': 'application/json' }
                : {}),
            ...headers,
        };

        try {
            const response = await this.sendRequest({
                url,
                method,
                headers: finalHeaders,
                cookies,
                body: payload,
            });

            return {
                id: uuid(),
                endpoint: path,
                method,
                profile,
                status: response.status,
                duration: response.duration,
                payload,
                responseBody: response.status >= 500 ? response.body : undefined,
                timestamp: Date.now(),
            };
        } catch (err) {
            const error = err instanceof Error ? err : new Error(String(err));
            return {
                id: uuid(),
                endpoint: path,
                method,
                profile,
                status: 0,
                duration: 0,
                payload,
                error: error.message,
                timestamp: Date.now(),
            };
        }
    }

    private updateStats(result: FuzzResult): void {
        this._stats.totalRequests++;
        this._stats.isRunning = true;

        // Status counts
        const status = result.status;
        this._stats.statusCounts[status] = (this._stats.statusCounts[status] || 0) + 1;

        // Profile counts
        this._stats.profileCounts[result.profile] =
            (this._stats.profileCounts[result.profile] || 0) + 1;

        // Endpoint × status heatmap
        if (!this._stats.endpointCounts[result.endpoint]) {
            this._stats.endpointCounts[result.endpoint] = {};
        }
        this._stats.endpointCounts[result.endpoint][status] =
            (this._stats.endpointCounts[result.endpoint][status] || 0) + 1;

        // RPS calculation
        const elapsed = (Date.now() - this._stats.startTime) / 1000;
        this._stats.requestsPerSecond =
            elapsed > 0 ? Math.round((this._stats.totalRequests / elapsed) * 10) / 10 : 0;
    }

    private createEmptyStats(): RunStats {
        return {
            totalRequests: 0,
            requestsPerSecond: 0,
            statusCounts: {},
            profileCounts: {} as Record<FuzzingProfile, number>,
            endpointCounts: {},
            startTime: Date.now(),
            isRunning: false,
        };
    }

    private sleep(ms: number): Promise<void> {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }
}
