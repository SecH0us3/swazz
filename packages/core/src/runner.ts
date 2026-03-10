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
import type { SchemaProperty } from './types.js';
import { uuid, int, word } from './random.js';

/**
 * Substitute {param} placeholders in a URL path with sensible fuzz values.
 * Uses the endpoint's pathParams schema when available, otherwise falls back
 * to a short random string (safe for UUIDs, IDs, slugs).
 */
function fillPathParams(
    path: string,
    pathParams: Record<string, SchemaProperty> = {},
    generator: SmartPayloadGenerator,
): string {
    return path.replace(/\{([^}]+)\}/g, (_match, name: string) => {
        const schema = pathParams[name] ?? pathParams[name.toLowerCase()] ?? { type: 'string' };

        const val = generator.generate(name, schema);
        return encodeURIComponent(String(val));
    });
}

// ─── Backoff constants ──────────────────────────────────────

const MAX_RETRIES_ON_429 = 3;
const DEFAULT_BACKOFF_MS = 2000;

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

        // Pre-calculate total planned requests for progress
        let totalPlanned = 0;
        for (const endpoint of endpoints) {
            const hasFields = endpoint.schema?.properties &&
                Object.keys(endpoint.schema.properties).length > 0;
            const isBodyMethod = !['GET', 'HEAD', 'DELETE', 'OPTIONS'].includes(
                endpoint.method.toUpperCase(),
            );
            const effectiveIter = hasFields ? iterations : 1;
            totalPlanned += profiles.length * effectiveIter;
        }
        this._stats.totalPlanned = totalPlanned;
        this._stats.progress.totalEndpoints = endpoints.length;

        try {
            for (let epIdx = 0; epIdx < endpoints.length; epIdx++) {
                const endpoint = endpoints[epIdx];
                if (this._shouldStop) break;

                const epKey = `${endpoint.method.toUpperCase()} ${endpoint.path}`;
                this._stats.progress.currentEndpoint = epKey;
                this._stats.progress.completedEndpoints = epIdx;

                // Determine if endpoint has fields to fuzz
                const hasFields = endpoint.schema?.properties &&
                    Object.keys(endpoint.schema.properties).length > 0;
                const isBodyMethod = !['GET', 'HEAD', 'DELETE', 'OPTIONS'].includes(
                    endpoint.method.toUpperCase(),
                );

                for (const profile of profiles) {
                    if (this._shouldStop) break;

                    this._stats.progress.currentProfile = profile;

                    // Smart iteration count:
                    // - Has fuzzable fields (body or query params) → full iterations
                    // - No fields → 1 request
                    const effectiveIterations = hasFields ? iterations : 1;

                    const generator = new SmartPayloadGenerator(dictionaries, profile);

                    // Process iterations with concurrency control
                    const tasks: Promise<void>[] = [];
                    let activeCount = 0;
                    const seenPayloads = new Set<string>();

                    for (let i = 0; i < effectiveIterations; i++) {
                        if (this._shouldStop) break;

                        let payload: any = undefined;
                        let queryParams: Record<string, any> | undefined = undefined;
                        let payloadStr = 'empty';
                        let isDuplicate = false;

                        if (hasFields) {
                            // Try up to 10 times to generate a unique payload for this iteration
                            for (let retries = 0; retries < 10; retries++) {
                                const generated = generator.buildObject(endpoint.schema);
                                if (isBodyMethod) {
                                    payload = generated;
                                } else {
                                    queryParams = generated;
                                }
                                payloadStr = JSON.stringify(generated);
                                if (!seenPayloads.has(payloadStr)) {
                                    isDuplicate = false;
                                    break;
                                }
                                isDuplicate = true;
                            }
                        } else {
                            isDuplicate = seenPayloads.has(payloadStr);
                        }

                        if (isDuplicate) {
                            // Exhausted retries or it's a static request we already sent — skip it to avoid identical spam
                            continue;
                        }
                        seenPayloads.add(payloadStr);

                        // Wait while paused
                        while (this._isPaused && !this._shouldStop) {
                            await this.sleep(100);
                        }
                        if (this._shouldStop) break;

                        // Concurrency limiter
                        while (activeCount >= concurrency) {
                            await this.sleep(10);
                        }

                        // Substitute path parameters for this iteration
                        const resolvedPath = fillPathParams(
                            endpoint.path,
                            endpoint.pathParams ?? {},
                            generator,
                        );

                        activeCount++;
                        const taskPromise = (async () => {
                            try {
                                const result = await this.executeRequest(
                                    base_url,
                                    resolvedPath,
                                    endpoint.path, // original path for heatmap keys
                                    endpoint.method,
                                    global_headers,
                                    cookies,
                                    payload,
                                    profile,
                                    queryParams,
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

                // Mark endpoint as done
                this._stats.progress.completedEndpoints = epIdx + 1;
                this.onProgress(this._stats);
            }
        } finally {
            this._isRunning = false;
            this._stats.isRunning = false;
            this._stats.progress.currentEndpoint = '';
            this._stats.progress.currentProfile = '';
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

    /**
     * Execute a single fuzz request with automatic 429 backoff.
     * `resolvedPath` is the URL path with substituted params.
     * `originalPath` is used as the heatmap key (keeps {id} template).
     */
    private async executeRequest(
        baseUrl: string,
        resolvedPath: string,
        originalPath: string,
        method: string,
        headers: Record<string, string>,
        cookies: Record<string, string>,
        payload: any,
        profile: FuzzingProfile,
        queryParams?: Record<string, any>,
    ): Promise<FuzzResult> {
        let url = baseUrl.replace(/\/$/, '') + resolvedPath;

        // Append query parameters for non-body methods (GET, DELETE, etc.)
        if (queryParams && Object.keys(queryParams).length > 0) {
            const qs = Object.entries(queryParams)
                .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
                .join('&');
            url += (url.includes('?') ? '&' : '?') + qs;
        }

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

        // 429 backoff loop
        let attempt = 0;
        while (true) {
            try {
                const response = await this.sendRequest({
                    url,
                    method,
                    headers: finalHeaders,
                    cookies,
                    body: payload,
                });

                // Handle rate limiting with automatic backoff
                if (response.status === 429 && attempt < MAX_RETRIES_ON_429) {
                    attempt++;
                    // Try to honor Retry-After header (sent back through body or via response headers)
                    // Since SendRequestFn doesn't expose headers, we use a fixed backoff with jitter
                    const backoffMs = DEFAULT_BACKOFF_MS * attempt + Math.random() * 500;
                    await this.sleep(backoffMs);
                    continue; // retry
                }

                return {
                    id: uuid(),
                    endpoint: originalPath,
                    resolvedPath,
                    method,
                    profile,
                    status: response.status,
                    duration: response.duration,
                    payload: payload ?? queryParams,
                    responseBody: response.status >= 400 ? response.body : undefined,
                    timestamp: Date.now(),
                    retries: attempt,
                };
            } catch (err) {
                const error = err instanceof Error ? err : new Error(String(err));
                return {
                    id: uuid(),
                    endpoint: originalPath,
                    resolvedPath,
                    method,
                    profile,
                    status: 0,
                    duration: 0,
                    payload,
                    error: error.message,
                    timestamp: Date.now(),
                    retries: attempt,
                };
            }
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

        // Endpoint × status heatmap (Method + original template path)
        const epKey = `${result.method.toUpperCase()} ${result.endpoint}`;
        if (!this._stats.endpointCounts[epKey]) {
            this._stats.endpointCounts[epKey] = {};
        }
        this._stats.endpointCounts[epKey][status] =
            (this._stats.endpointCounts[epKey][status] || 0) + 1;

        // RPS calculation
        const elapsed = (Date.now() - this._stats.startTime) / 1000;
        this._stats.requestsPerSecond =
            elapsed > 0 ? Math.round((this._stats.totalRequests / elapsed) * 10) / 10 : 0;
    }

    private createEmptyStats(): RunStats {
        return {
            totalRequests: 0,
            totalPlanned: 0,
            requestsPerSecond: 0,
            statusCounts: {},
            profileCounts: {} as Record<FuzzingProfile, number>,
            endpointCounts: {},
            startTime: Date.now(),
            isRunning: false,
            progress: {
                completedEndpoints: 0,
                totalEndpoints: 0,
                currentEndpoint: '',
                currentProfile: '',
            },
        };
    }

    private sleep(ms: number): Promise<void> {
        // Works in browser, Node.js and Cloudflare Workers without needing DOM lib
        return new Promise((resolve) => (globalThis as any).setTimeout(resolve, ms));
    }
}
