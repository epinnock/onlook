/**
 * compare-overlay-paths — parity-verification helper for ADR-0009 Phase 11b.
 *
 * Runs both the legacy (`wrapOverlayCode` + `pushOverlay`) and ABI v1
 * (`wrapOverlayV1` + `pushOverlayV1`) paths against the same input and
 * returns a structured diff report. Intended for:
 *
 *   1. Pre-flip soak: a background job can sample real edits, run both
 *      paths against an in-memory fake relay, and surface drift
 *      (size deltas, wire-shape mismatches, error-rate differences)
 *      BEFORE Phase 11b flips the default.
 *   2. CI regression guard: a single test that runs a canonical fixture
 *      through both paths and asserts the v1 output still mounts.
 *
 * Does NOT call the real pushOverlay/pushOverlayV1 — callers inject a
 * fake fetch so the diff is deterministic and doesn't depend on a
 * running relay.
 */

import {
    checkOverlaySize,
    wrapOverlayCode,
    wrapOverlayV1,
} from '../../../../../../packages/browser-bundler/src';

import { pushOverlay, pushOverlayV1 } from '@/services/expo-relay/push-overlay';

export interface CompareOverlayPathsInput {
    /** The esbuild-bundled CJS code (the user's compiled source). */
    readonly code: string;
    /** Optional source map (pass-through to both paths). */
    readonly sourceMap?: string;
    /** buildDurationMs for the v1 OverlayMeta. */
    readonly buildDurationMs: number;
    /** Session id used for both pushes. */
    readonly sessionId: string;
    /**
     * In-memory relay base URL. The comparator pushes BOTH legacy and v1
     * through this same base URL against the caller-provided fetchImpl so
     * the relay can diff the two bodies side-by-side.
     */
    readonly relayBaseUrl: string;
    /**
     * Caller-provided fetch stub. Each request's body is what the
     * comparator captures into the diff — typical test pattern:
     *
     *   const bodies = [];
     *   const fetchImpl = async (_url, init) => {
     *     bodies.push(init?.body);
     *     return new Response(JSON.stringify({ delivered: 1 }), { status: 202 });
     *   };
     */
    readonly fetchImpl: (
        input: RequestInfo | URL,
        init?: RequestInit,
    ) => Promise<Response>;
}

export interface OverlayPathDiff {
    readonly legacy: {
        readonly wrapOk: boolean;
        readonly wrapError?: string;
        readonly wrappedBytes: number;
        readonly pushOk: boolean;
        readonly pushError?: string;
        readonly bodyShape: 'overlay' | 'overlayUpdate' | 'unknown' | 'missing';
    };
    readonly v1: {
        readonly wrapOk: boolean;
        readonly wrapError?: string;
        readonly wrappedBytes: number;
        readonly pushOk: boolean;
        readonly pushError?: string;
        readonly bodyShape: 'overlay' | 'overlayUpdate' | 'unknown' | 'missing';
        readonly sizeGateStatus: 'ok' | 'warn-soft' | 'fail-hard' | 'skipped';
    };
    readonly parity: {
        /** True when both paths succeeded end-to-end (both wrap + both push). */
        readonly bothOk: boolean;
        /** True when both paths failed in the same phase (both wrap-error, or both push-error). */
        readonly bothFailedSamePhase: boolean;
        /** Byte-size delta (v1 wrappedBytes - legacy wrappedBytes). Positive = v1 is larger. */
        readonly wrappedBytesDelta: number;
    };
}

export async function compareOverlayPaths(
    input: CompareOverlayPathsInput,
): Promise<OverlayPathDiff> {
    // ─── Legacy path ────────────────────────────────────────────────────────
    const legacyResult = {
        wrapOk: false,
        wrapError: undefined as string | undefined,
        wrappedBytes: 0,
        pushOk: false,
        pushError: undefined as string | undefined,
        bodyShape: 'missing' as OverlayPathDiff['legacy']['bodyShape'],
    };

    let legacyWrapped: { code: string; sourceMap?: string } | undefined;
    try {
        legacyWrapped = wrapOverlayCode(input.code, {
            sourceMap: input.sourceMap,
        });
        legacyResult.wrapOk = true;
        legacyResult.wrappedBytes = byteLengthOf(legacyWrapped.code);
    } catch (err) {
        legacyResult.wrapError = errorMessage(err);
    }

    let legacyCapturedBody: unknown;
    if (legacyWrapped !== undefined) {
        const legacyFetch = wrapFetchWithCapture(input.fetchImpl, (body) => {
            legacyCapturedBody = body;
        });
        const result = await pushOverlay({
            relayBaseUrl: input.relayBaseUrl,
            sessionId: input.sessionId,
            overlay: {
                code: legacyWrapped.code,
                sourceMap: input.sourceMap,
            },
            fetchImpl: legacyFetch,
            onTelemetry: null,
        });
        legacyResult.pushOk = result.ok;
        if (!result.ok) legacyResult.pushError = result.error;
        legacyResult.bodyShape = classifyBodyShape(legacyCapturedBody);
    }

    // ─── V1 path ────────────────────────────────────────────────────────────
    const v1Result = {
        wrapOk: false,
        wrapError: undefined as string | undefined,
        wrappedBytes: 0,
        pushOk: false,
        pushError: undefined as string | undefined,
        bodyShape: 'missing' as OverlayPathDiff['v1']['bodyShape'],
        sizeGateStatus: 'skipped' as OverlayPathDiff['v1']['sizeGateStatus'],
    };

    let v1Wrapped: { code: string; sizeWarning?: string } | undefined;
    try {
        v1Wrapped = wrapOverlayV1(input.code, { sourceMap: input.sourceMap });
        v1Result.wrapOk = true;
        v1Result.wrappedBytes = byteLengthOf(v1Wrapped.code);
        v1Result.sizeGateStatus = checkOverlaySize(v1Wrapped.code).status;
    } catch (err) {
        v1Result.wrapError = errorMessage(err);
    }

    let v1CapturedBody: unknown;
    if (v1Wrapped !== undefined) {
        const v1Fetch = wrapFetchWithCapture(input.fetchImpl, (body) => {
            v1CapturedBody = body;
        });
        const result = await pushOverlayV1({
            relayBaseUrl: input.relayBaseUrl,
            sessionId: input.sessionId,
            overlay: {
                code: v1Wrapped.code,
                buildDurationMs: input.buildDurationMs,
            },
            fetchImpl: v1Fetch,
            onTelemetry: null,
        });
        v1Result.pushOk = result.ok;
        if (!result.ok) v1Result.pushError = result.error;
        v1Result.bodyShape = classifyBodyShape(v1CapturedBody);
    }

    return {
        legacy: legacyResult,
        v1: v1Result,
        parity: {
            bothOk: legacyResult.wrapOk && legacyResult.pushOk && v1Result.wrapOk && v1Result.pushOk,
            bothFailedSamePhase:
                (!legacyResult.wrapOk && !v1Result.wrapOk) ||
                (legacyResult.wrapOk && v1Result.wrapOk && !legacyResult.pushOk && !v1Result.pushOk),
            wrappedBytesDelta: v1Result.wrappedBytes - legacyResult.wrappedBytes,
        },
    };
}

// ─── helpers ─────────────────────────────────────────────────────────────────

function wrapFetchWithCapture(
    real: CompareOverlayPathsInput['fetchImpl'],
    capture: (body: unknown) => void,
): CompareOverlayPathsInput['fetchImpl'] {
    return async (input, init) => {
        if (typeof init?.body === 'string') {
            try {
                capture(JSON.parse(init.body));
            } catch {
                capture(init.body);
            }
        } else if (init?.body !== undefined) {
            capture(init.body);
        }
        return real(input, init);
    };
}

function classifyBodyShape(body: unknown): OverlayPathDiff['legacy']['bodyShape'] {
    if (body === undefined) return 'missing';
    if (typeof body !== 'object' || body === null) return 'unknown';
    const type = (body as { type?: unknown }).type;
    if (type === 'overlay') return 'overlay';
    if (type === 'overlayUpdate') return 'overlayUpdate';
    return 'unknown';
}

function byteLengthOf(s: string): number {
    return new TextEncoder().encode(s).byteLength;
}

function errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
}
