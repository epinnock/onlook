import { describe, expect, test } from 'bun:test';

import { pointerToDeviceCoords } from '../canvas-to-device-coords';

describe('pointerToDeviceCoords', () => {
    test('maps centered tap on portrait sim to (0.5, 0.5)', () => {
        const result = pointerToDeviceCoords(
            { offsetX: 195, offsetY: 422 },
            { width: 390, height: 844 },
            { width: 1170, height: 2532 },
        );
        expect(result.x).toBeCloseTo(0.5);
        expect(result.y).toBeCloseTo(0.5);
        expect(result.outside).toBe(false);
    });

    test('clamps and flags taps in horizontal letterbox as outside', () => {
        // Container wider than the rendered image → letterbox on the left/right.
        const result = pointerToDeviceCoords(
            { offsetX: 10, offsetY: 400 },
            { width: 800, height: 800 },
            { width: 400, height: 800 },
        );
        expect(result.outside).toBe(true);
    });

    test('handles vertical letterbox (container taller than image)', () => {
        const result = pointerToDeviceCoords(
            { offsetX: 200, offsetY: 10 },
            { width: 400, height: 1000 },
            { width: 400, height: 800 },
        );
        // Rendered image is 400x800 centered → top padding = 100.
        // offsetY=10 is in the padding → outside.
        expect(result.outside).toBe(true);
    });

    test('returns a safe zero when intrinsic size is unknown', () => {
        const result = pointerToDeviceCoords(
            { offsetX: 100, offsetY: 200 },
            { width: 400, height: 800 },
            { width: 0, height: 0 },
        );
        expect(result).toEqual({ x: 0, y: 0, outside: true });
    });

    test('respects scale when container is larger than intrinsic', () => {
        // Intrinsic 390x844 rendered into 780x1688 container → 2x scale.
        const result = pointerToDeviceCoords(
            { offsetX: 780, offsetY: 844 },
            { width: 780, height: 1688 },
            { width: 390, height: 844 },
        );
        expect(result.x).toBeCloseTo(1);
        expect(result.y).toBeCloseTo(0.5);
        expect(result.outside).toBe(false);
    });
});
