/**
 * Legacy path regression guard — task #62.
 *
 * Proves that with the legacy `shim`/`two-tier` feature flag OFF of v1 (the
 * default), `pushOverlay` (NOT `pushOverlayV1`) still emits the legacy
 * `OverlayMessage` wire shape. Any future refactor that accidentally routes
 * the legacy function through the v1 schema would fail these assertions.
 */
import { describe, expect, test } from 'bun:test';
import {
    OverlayMessageSchema,
    OverlayUpdateMessageSchema,
} from '@onlook/mobile-client-protocol';

import { pushOverlay } from '../push-overlay';

type MinimalFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

function captureFetch(): { fetchImpl: MinimalFetch; bodies: unknown[] } {
    const bodies: unknown[] = [];
    const fetchImpl: MinimalFetch = async (_input, init) => {
        if (typeof init?.body === 'string') {
            try {
                bodies.push(JSON.parse(init.body));
            } catch {
                bodies.push(init.body);
            }
        }
        return new Response(JSON.stringify({ delivered: 1 }), {
            status: 202,
            headers: { 'Content-Type': 'application/json' },
        });
    };
    return { fetchImpl, bodies };
}

describe('legacy pushOverlay path regression', () => {
    test('pushOverlay sends the legacy OverlayMessage shape (NOT OverlayUpdateMessage)', async () => {
        const { fetchImpl, bodies } = captureFetch();
        await pushOverlay({
            relayBaseUrl: 'https://r',
            sessionId: 'sess',
            overlay: { code: 'globalThis.x=1;' },
            fetchImpl,
            onTelemetry: null,
        });
        expect(bodies).toHaveLength(1);
        const body = bodies[0] as Record<string, unknown>;
        // Legacy shape: type="overlay", code (the user's CJS), no abi/sessionId/assets/meta.
        expect(body.type).toBe('overlay');
        expect(body.code).toBe('globalThis.x=1;');
        expect(body.abi).toBeUndefined();
        expect(body.assets).toBeUndefined();
        expect(body.meta).toBeUndefined();
    });

    test('legacy body validates as OverlayMessage (success) but NOT as OverlayUpdateMessage (fail)', async () => {
        const { fetchImpl, bodies } = captureFetch();
        await pushOverlay({
            relayBaseUrl: 'https://r',
            sessionId: 'sess',
            overlay: { code: 'x', sourceMap: '{"version":3}' },
            fetchImpl,
            onTelemetry: null,
        });
        const body = bodies[0] as unknown;
        expect(OverlayMessageSchema.safeParse(body).success).toBe(true);
        expect(OverlayUpdateMessageSchema.safeParse(body).success).toBe(false);
    });
});
