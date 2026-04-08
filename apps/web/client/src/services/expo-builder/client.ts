/**
 * HTTP client for cf-esm-builder (TH4.3).
 *
 * Wraps the POST /build, GET /build/:id, and GET /health endpoints defined
 * in `plans/expo-browser-builder-protocol.md` (TH0.2). Exposes a
 * `waitForBuild` convenience that polls with exponential backoff so the
 * orchestrator can await a terminal state.
 */

import type { BuildResponse, BuildStatus } from './types';

/**
 * Minimal fetch signature used by BuilderClient. Narrower than
 * `typeof fetch` so tests can supply a plain async function without
 * having to satisfy Bun-specific extras (e.g. `preconnect`).
 */
export type Fetcher = (
    input: RequestInfo | URL,
    init?: RequestInit,
) => Promise<Response>;

export interface BuilderClientOptions {
    /** Base URL of cf-esm-builder (e.g. http://127.0.0.1:8788 in dev). */
    baseUrl: string;
    /** Optional fetch override (for tests). */
    fetcher?: Fetcher;
}

export interface WaitForBuildOptions {
    signal?: AbortSignal;
    onUpdate?: (status: BuildStatus) => void;
    /** Override total wait ceiling (default 5 minutes). */
    timeoutMs?: number;
    /** Override initial poll interval (default 500ms). */
    initialPollMs?: number;
    /** Override max poll interval (default 10s). */
    maxPollMs?: number;
    /**
     * Sleep implementation (injectable so tests can control the clock
     * without globally stubbing `setTimeout`).
     */
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
}

export class BuilderClientError extends Error {
    readonly status: number;
    readonly body: string;

    constructor(message: string, status: number, body: string) {
        super(message);
        this.name = 'BuilderClientError';
        this.status = status;
        this.body = body;
    }
}

const DEFAULT_INITIAL_POLL_MS = 500;
const DEFAULT_MAX_POLL_MS = 10_000;
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000;

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(signal.reason ?? new Error('aborted'));
            return;
        }
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timer);
            signal?.removeEventListener('abort', onAbort);
            reject(signal?.reason ?? new Error('aborted'));
        };
        signal?.addEventListener('abort', onAbort);
    });
}

function stripTrailingSlash(url: string): string {
    return url.endsWith('/') ? url.slice(0, -1) : url;
}

export class BuilderClient {
    private readonly baseUrl: string;
    private readonly fetcher: Fetcher;

    constructor(opts: BuilderClientOptions) {
        this.baseUrl = stripTrailingSlash(opts.baseUrl);
        this.fetcher = opts.fetcher ?? ((input, init) => fetch(input, init));
    }

    /**
     * POST /build — upload source tar and enqueue/coalesce a build.
     */
    async postSource(
        tar: ArrayBuffer,
        projectId: string,
        branchId: string,
    ): Promise<BuildResponse> {
        const res = await this.fetcher(`${this.baseUrl}/build`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-tar',
                'X-Project-Id': projectId,
                'X-Branch-Id': branchId,
            },
            body: tar,
        });

        if (!res.ok) {
            const body = await safeReadText(res);
            throw new BuilderClientError(
                `postSource failed: ${res.status}`,
                res.status,
                body,
            );
        }

        return (await res.json()) as BuildResponse;
    }

    /**
     * GET /build/:buildId — single status poll.
     */
    async getStatus(buildId: string): Promise<BuildStatus> {
        const res = await this.fetcher(
            `${this.baseUrl}/build/${encodeURIComponent(buildId)}`,
        );
        if (!res.ok) {
            const body = await safeReadText(res);
            throw new BuilderClientError(
                `getStatus failed: ${res.status}`,
                res.status,
                body,
            );
        }
        return (await res.json()) as BuildStatus;
    }

    /**
     * Poll `getStatus` until a terminal state (`ready` or `failed`) or
     * until the timeout elapses. Exponential backoff: initial 500ms,
     * doubling up to 10s, capped at 5min total.
     */
    async waitForBuild(
        buildId: string,
        opts: WaitForBuildOptions = {},
    ): Promise<BuildStatus> {
        const signal = opts.signal;
        const onUpdate = opts.onUpdate;
        const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        const initialPollMs = opts.initialPollMs ?? DEFAULT_INITIAL_POLL_MS;
        const maxPollMs = opts.maxPollMs ?? DEFAULT_MAX_POLL_MS;
        const sleep = opts.sleep ?? defaultSleep;

        const start = Date.now();
        let delay = initialPollMs;

        while (true) {
            if (signal?.aborted) {
                throw signal.reason ?? new Error('waitForBuild aborted');
            }

            const status = await this.getStatus(buildId);
            onUpdate?.(status);

            if (status.state === 'ready' || status.state === 'failed') {
                return status;
            }

            const elapsed = Date.now() - start;
            if (elapsed >= timeoutMs) {
                throw new BuilderClientError(
                    `waitForBuild timed out after ${timeoutMs}ms (last state: ${status.state})`,
                    0,
                    JSON.stringify(status),
                );
            }

            const remaining = timeoutMs - elapsed;
            const nextDelay = Math.min(delay, maxPollMs, remaining);
            await sleep(nextDelay, signal);
            delay = Math.min(delay * 2, maxPollMs);
        }
    }

    /**
     * GET /health — returns `{ ok: true }` on a 200 response, `{ ok:
     * false }` otherwise. Does not throw on non-200 so dashboards can
     * poll without try/catch noise.
     */
    async health(): Promise<{ ok: boolean }> {
        try {
            const res = await this.fetcher(`${this.baseUrl}/health`);
            return { ok: res.ok };
        } catch {
            return { ok: false };
        }
    }
}

async function safeReadText(res: Response): Promise<string> {
    try {
        return await res.text();
    } catch {
        return '';
    }
}
