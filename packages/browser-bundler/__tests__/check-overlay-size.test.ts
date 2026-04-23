import { describe, expect, test } from 'bun:test';

import { checkOverlaySize } from '../src/check-overlay-size';
import { OVERLAY_SIZE_HARD_CAP, OVERLAY_SIZE_SOFT_CAP } from '../src/wrap-overlay-v1';

describe('checkOverlaySize — string bundle', () => {
    test('small bundle returns status="ok"', () => {
        const r = checkOverlaySize('export default null;');
        expect(r.status).toBe('ok');
        expect(r.bytes).toBe(20);
        expect(r.softCap).toBe(OVERLAY_SIZE_SOFT_CAP);
        expect(r.hardCap).toBe(OVERLAY_SIZE_HARD_CAP);
        // Message format: "Overlay bundle is N bytes (X% of soft cap)."
        expect(r.message).toContain('20 bytes');
        expect(r.message).toContain('soft cap');
    });

    test('UTF-8 multi-byte chars are counted as encoded bytes, not code units', () => {
        const r = checkOverlaySize('héllo'); // 5 chars, 6 UTF-8 bytes
        expect(r.bytes).toBe(6);
    });

    test('byteLength derives from TextEncoder for strings', () => {
        // 4-byte emoji.
        const r = checkOverlaySize('🎉');
        expect(r.bytes).toBe(4);
    });
});

describe('checkOverlaySize — Uint8Array bundle', () => {
    test('uses byteLength directly for Uint8Array input', () => {
        const r = checkOverlaySize(new Uint8Array(1024));
        expect(r.bytes).toBe(1024);
        expect(r.status).toBe('ok');
    });
});

describe('checkOverlaySize — soft cap', () => {
    test('exact-soft-cap bytes returns status="ok" (uses > not >=)', () => {
        const r = checkOverlaySize(new Uint8Array(OVERLAY_SIZE_SOFT_CAP));
        expect(r.bytes).toBe(OVERLAY_SIZE_SOFT_CAP);
        expect(r.status).toBe('ok');
    });

    test('1 byte over soft cap returns status="warn-soft" + message references soft cap', () => {
        const r = checkOverlaySize(new Uint8Array(OVERLAY_SIZE_SOFT_CAP + 1));
        expect(r.status).toBe('warn-soft');
        expect(r.message).toContain('soft cap');
    });

    test('mid-range (between soft and hard) returns warn-soft', () => {
        const mid = Math.floor((OVERLAY_SIZE_SOFT_CAP + OVERLAY_SIZE_HARD_CAP) / 2);
        const r = checkOverlaySize(new Uint8Array(mid));
        expect(r.status).toBe('warn-soft');
        expect(r.bytes).toBe(mid);
    });
});

describe('checkOverlaySize — hard cap', () => {
    test('exact-hard-cap bytes still warn-soft (uses > not >=)', () => {
        const r = checkOverlaySize(new Uint8Array(OVERLAY_SIZE_HARD_CAP));
        expect(r.status).toBe('warn-soft');
    });

    test('1 byte over hard cap returns status="fail-hard"', () => {
        const r = checkOverlaySize(new Uint8Array(OVERLAY_SIZE_HARD_CAP + 1));
        expect(r.status).toBe('fail-hard');
        expect(r.message).toContain('exceeds the hard cap');
    });
});

describe('checkOverlaySize — option overrides', () => {
    test('honors a tighter softCap override', () => {
        const r = checkOverlaySize(new Uint8Array(100), { softCap: 50, hardCap: 200 });
        expect(r.status).toBe('warn-soft');
        expect(r.softCap).toBe(50);
        expect(r.hardCap).toBe(200);
    });

    test('honors a tighter hardCap override', () => {
        const r = checkOverlaySize(new Uint8Array(300), { softCap: 50, hardCap: 200 });
        expect(r.status).toBe('fail-hard');
    });

    test('throws when softCap >= hardCap (caller misconfiguration)', () => {
        expect(() =>
            checkOverlaySize(new Uint8Array(10), { softCap: 100, hardCap: 100 }),
        ).toThrow(/softCap.*must be less than hardCap/);
    });
});

describe('checkOverlaySize — message formatting', () => {
    test('ok status reports byte count + percent of soft cap', () => {
        const r = checkOverlaySize(new Uint8Array(100), { softCap: 1000, hardCap: 10000 });
        expect(r.message).toContain('100 bytes');
        expect(r.message).toContain('10.0%');
    });

    test('warn-soft message includes both the bytes and soft cap', () => {
        const r = checkOverlaySize(new Uint8Array(150), { softCap: 100, hardCap: 200 });
        expect(r.message).toContain('150 bytes');
        expect(r.message).toContain('100');
    });

    test('fail-hard message includes the bytes and hard cap', () => {
        const r = checkOverlaySize(new Uint8Array(250), { softCap: 100, hardCap: 200 });
        expect(r.message).toContain('250 bytes');
        expect(r.message).toContain('200');
    });
});
