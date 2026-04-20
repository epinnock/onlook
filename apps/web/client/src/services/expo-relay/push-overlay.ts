/**
 * Push-overlay client — posts a built overlay to
 * `cf-expo-relay POST /push/:sessionId`.
 *
 * The editor's browser-bundler worker produces a CJS code string + optional
 * source map. This module serializes that into the OverlayMessage wire shape
 * (see packages/mobile-client-protocol/src/overlay.ts) and POSTs it. The
 * relay routes the payload to the matching HmrSession DO which broadcasts
 * to connected mobile clients.
 *
 * Gated by the `two-tier` feature flag — callers should check
 * `isTwoTierPipelineEnabled()` before using this path.
 */
import type { OverlayMessage } from '@onlook/mobile-client-protocol';

export interface OverlaySource {
    readonly code: string;
    readonly sourceMap?: string;
}

export interface PushOverlayTelemetry {
    readonly sessionId: string;
    readonly attempts: number;
    readonly durationMs: number;
    readonly bytes: number;
    readonly delivered?: number;
    readonly status?: number;
    readonly ok: boolean;
    readonly error?: string;
}

export interface PushOverlayOptions {
    readonly relayBaseUrl: string;
    readonly sessionId: string;
    readonly overlay: OverlaySource;
    /**
     * Injectable for tests. Defaults to `globalThis.fetch`. We accept the
     * minimal `(input, init) => Promise<Response>` shape rather than
     * `typeof fetch` so test fakes don't have to implement `preconnect`
     * and other ambient members Bun adds to the global fetch typing.
     */
    readonly fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    /** Maximum retries for transient (5xx / network) failures. Default 2. */
    readonly maxRetries?: number;
    /** Base delay between retries in ms. Default 100. */
    readonly retryBaseMs?: number;
    /**
     * Optional observer for latency + delivery metrics. Always called once
     * per `pushOverlay` invocation (success or failure). Defaults to a
     * structured `console.info` in dev; pass `null` to silence.
     */
    readonly onTelemetry?: ((event: PushOverlayTelemetry) => void) | null;
}

export interface PushOverlaySuccess {
    readonly ok: true;
    readonly delivered: number;
    readonly attempts: number;
}

export interface PushOverlayFailure {
    readonly ok: false;
    readonly error: string;
    readonly status?: number;
    readonly attempts: number;
}

export type PushOverlayResult = PushOverlaySuccess | PushOverlayFailure;

const SESSION_ID_RE = /^[A-Za-z0-9_-]{1,128}$/;

function buildOverlayMessage(source: OverlaySource): OverlayMessage {
    const message: OverlayMessage = {
        type: 'overlay',
        code: source.code,
        ...(source.sourceMap !== undefined ? { sourceMap: source.sourceMap } : {}),
    };
    return message;
}

function buildPushUrl(baseUrl: string, sessionId: string): string {
    const trimmed = baseUrl.replace(/\/+$/, '');
    return `${trimmed}/push/${encodeURIComponent(sessionId)}`;
}

function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * POST the overlay to the relay. Retries on network errors and 5xx.
 *
 * Never throws — always returns a `PushOverlayResult` so callers can
 * branch on `ok` without try/catch. Mirrors the result-type convention
 * the mobile-client relay modules already use.
 */
const DEFAULT_TELEMETRY = (event: PushOverlayTelemetry): void => {
    // Structured console.info so devtools can filter and reason about it.
    // eslint-disable-next-line no-console
    console.info('[onlook.push-overlay]', event);
};

export async function pushOverlay(options: PushOverlayOptions): Promise<PushOverlayResult> {
    const telemetry =
        options.onTelemetry === null
            ? null
            : options.onTelemetry ?? DEFAULT_TELEMETRY;

    const emit = (event: PushOverlayTelemetry): void => {
        if (telemetry) {
            try {
                telemetry(event);
            } catch {
                // Telemetry sinks must never affect control flow.
            }
        }
    };

    if (!options.sessionId || !SESSION_ID_RE.test(options.sessionId)) {
        const result: PushOverlayResult = {
            ok: false,
            error: `invalid sessionId "${options.sessionId}"`,
            attempts: 0,
        };
        emit({
            sessionId: options.sessionId,
            attempts: 0,
            durationMs: 0,
            bytes: 0,
            ok: false,
            error: result.error,
        });
        return result;
    }
    if (!options.overlay.code || options.overlay.code.length === 0) {
        const result: PushOverlayResult = {
            ok: false,
            error: 'overlay code is empty',
            attempts: 0,
        };
        emit({
            sessionId: options.sessionId,
            attempts: 0,
            durationMs: 0,
            bytes: 0,
            ok: false,
            error: result.error,
        });
        return result;
    }

    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') {
        const result: PushOverlayResult = {
            ok: false,
            error: 'fetch is not available in this runtime',
            attempts: 0,
        };
        emit({
            sessionId: options.sessionId,
            attempts: 0,
            durationMs: 0,
            bytes: 0,
            ok: false,
            error: result.error,
        });
        return result;
    }

    const url = buildPushUrl(options.relayBaseUrl, options.sessionId);
    const body = JSON.stringify(buildOverlayMessage(options.overlay));
    const bytes =
        typeof Buffer !== 'undefined' ? Buffer.byteLength(body, 'utf8') : new TextEncoder().encode(body).length;
    const maxRetries = options.maxRetries ?? 2;
    const retryBaseMs = options.retryBaseMs ?? 100;
    const startedAt = performance.now();

    let attempts = 0;
    let lastError = 'unknown error';
    let lastStatus: number | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        attempts += 1;
        try {
            const response = await fetchImpl(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body,
            });

            if (response.ok) {
                let delivered = 0;
                try {
                    const parsed = (await response.json()) as { delivered?: number };
                    if (typeof parsed.delivered === 'number') {
                        delivered = parsed.delivered;
                    }
                } catch {
                    // The relay currently returns `{ delivered: N }`; a
                    // missing body isn't fatal — just report 0.
                }
                const result: PushOverlaySuccess = { ok: true, delivered, attempts };
                emit({
                    sessionId: options.sessionId,
                    attempts,
                    durationMs: performance.now() - startedAt,
                    bytes,
                    delivered,
                    status: response.status,
                    ok: true,
                });
                return result;
            }

            lastStatus = response.status;
            lastError = `relay responded ${response.status}`;

            // 4xx is caller-fixable; don't retry.
            if (response.status >= 400 && response.status < 500) {
                const result: PushOverlayResult = {
                    ok: false,
                    error: lastError,
                    status: response.status,
                    attempts,
                };
                emit({
                    sessionId: options.sessionId,
                    attempts,
                    durationMs: performance.now() - startedAt,
                    bytes,
                    status: response.status,
                    ok: false,
                    error: lastError,
                });
                return result;
            }
        } catch (err: unknown) {
            lastError = err instanceof Error ? err.message : 'network error';
            lastStatus = undefined;
        }

        if (attempt < maxRetries) {
            await sleep(retryBaseMs * Math.pow(2, attempt));
        }
    }

    const result: PushOverlayResult = {
        ok: false,
        error: lastError,
        ...(lastStatus !== undefined ? { status: lastStatus } : {}),
        attempts,
    };
    emit({
        sessionId: options.sessionId,
        attempts,
        durationMs: performance.now() - startedAt,
        bytes,
        ...(lastStatus !== undefined ? { status: lastStatus } : {}),
        ok: false,
        error: lastError,
    });
    return result;
}
