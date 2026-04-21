/**
 * workers-pipeline editor — ABI v1 dispatch spec (task #33).
 *
 * Headless Playwright/Node-side spec (no browser — this only exercises the
 * editor's overlay-v1 service layer). The real Chromium-driven spec lands
 * when the editor UI is wired to consume `isOverlayV1Enabled()`.
 *
 * Asserts:
 *  1. `classifyPipelineValue('overlay-v1')` returns the literal.
 *  2. `isOverlayV1Enabled()` is true ONLY when the flag matches.
 *  3. The expo-relay barrel exports the v1-era helpers (pushOverlayV1,
 *     buildEditorAbiHello, OverlayStatusMachine, createOverlayDebouncer,
 *     createReconnectReplayer, fetchOverlaySourceMap).
 *  4. pushOverlayV1 emits an OverlayUpdateMessage shape; no pushOverlay
 *     (legacy) calls fire from the same test.
 */
import { expect, test } from '@playwright/test';

import * as expoRelay from '../../../../../../apps/web/client/src/services/expo-relay';
import {
    classifyPipelineValue,
    isOverlayV1Enabled,
} from '../../../../../../apps/mobile-client/src/flow/featureFlags';
import {
    OverlayUpdateMessageSchema,
} from '../../../../../../packages/mobile-client-protocol/src/abi-v1';
import { pushOverlayV1 } from '../../../../../../apps/web/client/src/services/expo-relay/push-overlay';

test.describe('workers-pipeline editor — overlay-v1 dispatch', () => {
    test('feature flag: overlay-v1 is gated behind the exact literal', () => {
        expect(classifyPipelineValue('overlay-v1')).toBe('overlay-v1');
        expect(classifyPipelineValue('OVERLAY-V1')).toBe('shim');
        expect(classifyPipelineValue('overlay_v1')).toBe('shim');
        expect(classifyPipelineValue('v1')).toBe('shim');
    });

    test('isOverlayV1Enabled reads the env literally', () => {
        const prior = process.env.EXPO_PUBLIC_MOBILE_PREVIEW_PIPELINE;
        try {
            process.env.EXPO_PUBLIC_MOBILE_PREVIEW_PIPELINE = 'overlay-v1';
            expect(isOverlayV1Enabled()).toBe(true);
            process.env.EXPO_PUBLIC_MOBILE_PREVIEW_PIPELINE = 'two-tier';
            expect(isOverlayV1Enabled()).toBe(false);
            process.env.EXPO_PUBLIC_MOBILE_PREVIEW_PIPELINE = 'shim';
            expect(isOverlayV1Enabled()).toBe(false);
            delete process.env.EXPO_PUBLIC_MOBILE_PREVIEW_PIPELINE;
            expect(isOverlayV1Enabled()).toBe(false);
        } finally {
            if (prior === undefined) {
                delete process.env.EXPO_PUBLIC_MOBILE_PREVIEW_PIPELINE;
            } else {
                process.env.EXPO_PUBLIC_MOBILE_PREVIEW_PIPELINE = prior;
            }
        }
    });

    test('expo-relay barrel exports every v1-era helper', () => {
        const names = new Set(Object.keys(expoRelay));
        for (const expected of [
            // v1 push
            'pushOverlayV1',
            // abi-hello
            'buildEditorAbiHello',
            'startEditorAbiHandshake',
            // status machine
            'OverlayStatusMachine',
            'OverlayStatusTransitionError',
            'canTransition',
            // debouncer
            'createOverlayDebouncer',
            // reconnect
            'createReconnectReplayer',
            // source map
            'fetchOverlaySourceMap',
            'resolveOverlayFrame',
            'decorateRuntimeErrorWithSourceMap',
        ]) {
            expect(names.has(expected)).toBe(true);
        }
    });

    test('pushOverlayV1 emits OverlayUpdateMessage shape; legacy pushOverlay stays untouched', async () => {
        const sent: string[] = [];
        const fakeFetch: (
            input: RequestInfo | URL,
            init?: RequestInit,
        ) => Promise<Response> = async (_input, init) => {
            if (typeof init?.body === 'string') sent.push(init.body);
            return new Response(JSON.stringify({ delivered: 1 }), { status: 202 });
        };
        const result = await pushOverlayV1({
            relayBaseUrl: 'https://relay-test.example.com',
            sessionId: 'e2e-v1',
            overlay: { code: 'module.exports = { default: 1 };', buildDurationMs: 11 },
            fetchImpl: fakeFetch,
            onTelemetry: null,
        });
        expect(result.ok).toBe(true);
        expect(sent).toHaveLength(1);
        const parsed = OverlayUpdateMessageSchema.safeParse(JSON.parse(sent[0]!));
        expect(parsed.success).toBe(true);
        if (parsed.success) {
            expect(parsed.data.type).toBe('overlayUpdate');
            expect(parsed.data.abi).toBe('v1');
            expect(parsed.data.sessionId).toBe('e2e-v1');
            expect(parsed.data.meta.entryModule).toBe(0);
            expect(typeof parsed.data.meta.overlayHash).toBe('string');
        }
    });
});
