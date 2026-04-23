/**
 * Negative-case sweep for the ABI v1 contract — task #98.
 *
 * Every test here asserts the editor/relay/runtime refuses to work with data
 * that violates the ADR. If any of these start passing invalid data, the
 * ABI has drifted.
 */
import { describe, expect, test } from 'bun:test';

import {
    ABI_VERSION,
    AbiHelloMessageSchema,
    AssetDescriptorSchema,
    BaseManifestSchema,
    OverlayAckMessageSchema,
    OverlayAssetManifestSchema,
    OverlayUpdateMessageSchema,
    RuntimeCapabilitiesSchema,
    assertOverlayAbiCompatible,
    checkAbiCompatibility,
} from '../src/abi-v1';

describe('ABI v1 negative cases — AssetDescriptor', () => {
    test('image descriptor rejects non-positive width/height', () => {
        expect(
            AssetDescriptorSchema.safeParse({
                kind: 'image',
                hash: 'x',
                mime: 'image/png',
                uri: 'u',
                width: 0,
            }).success,
        ).toBe(false);
        expect(
            AssetDescriptorSchema.safeParse({
                kind: 'image',
                hash: 'x',
                mime: 'image/png',
                uri: 'u',
                height: -1,
            }).success,
        ).toBe(false);
    });

    test('font descriptor rejects non-integer or negative weight', () => {
        expect(
            AssetDescriptorSchema.safeParse({
                kind: 'font',
                hash: 'x',
                mime: 'font/ttf',
                family: 'I',
                uri: 'u',
                weight: 400.5,
            }).success,
        ).toBe(false);
        expect(
            AssetDescriptorSchema.safeParse({
                kind: 'font',
                hash: 'x',
                mime: 'font/ttf',
                family: 'I',
                uri: 'u',
                weight: -100,
            }).success,
        ).toBe(false);
    });

    test('font descriptor rejects style other than normal/italic', () => {
        expect(
            AssetDescriptorSchema.safeParse({
                kind: 'font',
                hash: 'x',
                mime: 'font/ttf',
                family: 'I',
                uri: 'u',
                style: 'oblique',
            }).success,
        ).toBe(false);
    });

    test('svg descriptor rejects non-svg mime type', () => {
        expect(
            AssetDescriptorSchema.safeParse({
                kind: 'svg',
                hash: 'x',
                mime: 'image/png',
                uri: 'u',
            }).success,
        ).toBe(false);
    });

    test('empty hash is rejected across every descriptor kind', () => {
        for (const d of [
            { kind: 'image', hash: '', mime: 'image/png', uri: 'u' },
            { kind: 'json', hash: '', value: 1 },
            { kind: 'text', hash: '', value: 'x' },
        ]) {
            expect(AssetDescriptorSchema.safeParse(d).success).toBe(false);
        }
    });
});

describe('ABI v1 negative cases — OverlayUpdateMessage', () => {
    const ok = {
        type: 'overlayUpdate' as const,
        abi: ABI_VERSION,
        sessionId: 's',
        source: 'module.exports = {};',
        assets: { abi: ABI_VERSION, assets: {} },
        meta: { overlayHash: 'h'.repeat(16), entryModule: 0 as const, buildDurationMs: 0 },
    };

    test('rejects abi other than v1', () => {
        expect(OverlayUpdateMessageSchema.safeParse({ ...ok, abi: 'v2' }).success).toBe(false);
    });

    test('rejects empty source', () => {
        expect(OverlayUpdateMessageSchema.safeParse({ ...ok, source: '' }).success).toBe(false);
    });

    test('rejects wrong entryModule value (must be exactly 0 in v1)', () => {
        expect(
            OverlayUpdateMessageSchema.safeParse({
                ...ok,
                meta: { ...ok.meta, entryModule: 1 },
            }).success,
        ).toBe(false);
    });

    test('rejects negative buildDurationMs', () => {
        expect(
            OverlayUpdateMessageSchema.safeParse({
                ...ok,
                meta: { ...ok.meta, buildDurationMs: -1 },
            }).success,
        ).toBe(false);
    });

    test('rejects missing assets field', () => {
        const { assets: _omit, ...without } = ok;
        expect(OverlayUpdateMessageSchema.safeParse(without).success).toBe(false);
    });
});

describe('ABI v1 negative cases — BaseManifest', () => {
    const ok = {
        abi: ABI_VERSION,
        bundleHash: 'h',
        aliasHash: 'h',
        rnVersion: '0.81.6',
        expoSdk: '54.0.0',
        reactVersion: '19.1.4',
        platform: 'ios' as const,
        bundleUrl: 'https://r2/bundle.js',
        aliases: ['react'],
    };

    test('rejects non-URL bundleUrl', () => {
        expect(BaseManifestSchema.safeParse({ ...ok, bundleUrl: 'not a url' }).success).toBe(false);
    });

    test('rejects unknown platform', () => {
        expect(BaseManifestSchema.safeParse({ ...ok, platform: 'windows' }).success).toBe(false);
    });

    test('rejects missing required fields', () => {
        const { rnVersion: _rn, ...without } = ok;
        expect(BaseManifestSchema.safeParse(without).success).toBe(false);
    });
});

describe('ABI v1 negative cases — version negotiation', () => {
    const caps = {
        abi: ABI_VERSION,
        baseHash: 'h',
        rnVersion: '0.81.6',
        expoSdk: '54.0.0',
        platform: 'ios' as const,
        aliases: [],
    };

    test('checkAbiCompatibility returns abi-mismatch error for divergent abi', () => {
        const result = checkAbiCompatibility(ABI_VERSION, { ...caps, abi: 'v0' as never });
        expect(result?.kind).toBe('abi-mismatch');
    });

    test('assertOverlayAbiCompatible throws on mismatch with __onlookError kind=abi-mismatch', () => {
        let caught: unknown;
        try {
            assertOverlayAbiCompatible(ABI_VERSION, 'v0' as never);
        } catch (e) {
            caught = e;
        }
        const err = caught as Error & { __onlookError?: { kind?: string } };
        expect(err?.__onlookError?.kind).toBe('abi-mismatch');
    });
});

describe('ABI v1 negative cases — OverlayAssetManifest', () => {
    test('rejects when abi is missing', () => {
        expect(
            OverlayAssetManifestSchema.safeParse({ assets: {} }).success,
        ).toBe(false);
    });

    test('rejects when assets contains an invalid descriptor', () => {
        expect(
            OverlayAssetManifestSchema.safeParse({
                abi: ABI_VERSION,
                assets: { x: { kind: 'invalid-kind', hash: 'h' } },
            }).success,
        ).toBe(false);
    });
});

describe('ABI v1 negative cases — AbiHelloMessage', () => {
    const baseCaps = {
        abi: ABI_VERSION,
        baseHash: 'h',
        rnVersion: '0.81.6',
        expoSdk: '54.0.0',
        platform: 'ios' as const,
        aliases: [],
    };

    test('rejects role other than editor/phone', () => {
        expect(
            AbiHelloMessageSchema.safeParse({
                type: 'abiHello',
                abi: ABI_VERSION,
                sessionId: 's',
                role: 'relay',
                runtime: baseCaps,
            }).success,
        ).toBe(false);
    });

    test('rejects missing runtime capabilities', () => {
        expect(
            AbiHelloMessageSchema.safeParse({
                type: 'abiHello',
                abi: ABI_VERSION,
                sessionId: 's',
                role: 'editor',
            }).success,
        ).toBe(false);
    });

    test('round-trip via RuntimeCapabilitiesSchema preserves shape', () => {
        const parsed = RuntimeCapabilitiesSchema.parse(baseCaps);
        expect(parsed).toEqual(baseCaps);
    });
});

describe('ABI v1 — OverlayAckMessage', () => {
    const validAck = {
        type: 'onlook:overlayAck' as const,
        sessionId: 'sess-1',
        overlayHash: 'abc123',
        status: 'mounted' as const,
        timestamp: 1700000000,
    };

    test('accepts minimal mounted ack (no mountDurationMs)', () => {
        const parsed = OverlayAckMessageSchema.parse(validAck);
        expect(parsed.status).toBe('mounted');
        expect(parsed.mountDurationMs).toBeUndefined();
    });

    test('accepts optional mountDurationMs for eval-latency soak signal', () => {
        // Phone populates this with `performance.now()` delta around the
        // mount call. Phase 11b dashboard uses it to compute p95 eval
        // latency against the ADR-0001 ≤100ms target.
        const parsed = OverlayAckMessageSchema.parse({
            ...validAck,
            mountDurationMs: 42,
        });
        expect(parsed.mountDurationMs).toBe(42);
    });

    test('rejects negative mountDurationMs', () => {
        expect(
            OverlayAckMessageSchema.safeParse({
                ...validAck,
                mountDurationMs: -1,
            }).success,
        ).toBe(false);
    });

    test('rejects NaN mountDurationMs', () => {
        expect(
            OverlayAckMessageSchema.safeParse({
                ...validAck,
                mountDurationMs: NaN,
            }).success,
        ).toBe(false);
    });

    test('rejects Infinity mountDurationMs (would poison p95 aggregates)', () => {
        expect(
            OverlayAckMessageSchema.safeParse({
                ...validAck,
                mountDurationMs: Infinity,
            }).success,
        ).toBe(false);
    });

    test('rejects -Infinity mountDurationMs', () => {
        expect(
            OverlayAckMessageSchema.safeParse({
                ...validAck,
                mountDurationMs: -Infinity,
            }).success,
        ).toBe(false);
    });

    test('backward compat: legacy phone binaries (no mountDurationMs) still pass', () => {
        // This is the invariant that lets this field land before every
        // phone binary populates it. If this test ever fails, the field
        // has been accidentally made required, blocking the soft-launch.
        const { mountDurationMs: _omit, ...legacyShape } = {
            ...validAck,
            mountDurationMs: 0,
        };
        expect(OverlayAckMessageSchema.safeParse(legacyShape).success).toBe(
            true,
        );
    });

    test('failed-status ack with an error + mountDurationMs is valid', () => {
        // Phone populates mountDurationMs even on failure (time spent
        // trying before the throw) — useful for "how long does it take
        // to fail" distributions.
        const parsed = OverlayAckMessageSchema.parse({
            ...validAck,
            status: 'failed',
            mountDurationMs: 150,
            error: { kind: 'overlay-runtime', message: 'TypeError' },
        });
        expect(parsed.status).toBe('failed');
        expect(parsed.mountDurationMs).toBe(150);
    });
});
