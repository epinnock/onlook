/**
 * Smoke tests for `useFrameReload`.
 *
 * Covers the shape the hook returns — importantly the new
 * `hasGivenUp` + `immediateReload` contract added in commit a33e0405
 * that caps Penpal reconnect attempts at 10. The hook's timing
 * behavior (debounce + setTimeout) can't be exercised fully without a
 * React test renderer + fake timers, so this file locks in the
 * public-API shape and defers the retry-cap integration test to the
 * Playwright flow (apps/web/client/e2e/*).
 */

import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import { useFrameReload } from '../use-frame-reload';

describe('useFrameReload — smoke', () => {
    test('returns the full contract on initial mount', () => {
        let captured: ReturnType<typeof useFrameReload> | null = null;
        function Probe() {
            captured = useFrameReload();
            return <div data-testid="probe" />;
        }
        renderToStaticMarkup(<Probe />);
        expect(captured).not.toBeNull();
        const c = captured!;
        // Shape — every key the frame index.tsx destructures must be here.
        expect(typeof c.reloadKey).toBe('number');
        expect(typeof c.isPenpalConnected).toBe('boolean');
        expect(typeof c.hasGivenUp).toBe('boolean');
        expect(typeof c.immediateReload).toBe('function');
        expect(typeof c.handleConnectionFailed).toBe('function');
        expect(typeof c.handleConnectionSuccess).toBe('function');
        expect(typeof c.getPenpalTimeout).toBe('function');
    });

    test('initial state — not connected, not given up, key 0', () => {
        let captured: ReturnType<typeof useFrameReload> | null = null;
        function Probe() {
            captured = useFrameReload();
            return <div />;
        }
        renderToStaticMarkup(<Probe />);
        const c = captured!;
        expect(c.reloadKey).toBe(0);
        expect(c.isPenpalConnected).toBe(false);
        expect(c.hasGivenUp).toBe(false);
    });

    test('getPenpalTimeout starts at the base 5000ms on a fresh mount', () => {
        let captured: ReturnType<typeof useFrameReload> | null = null;
        function Probe() {
            captured = useFrameReload();
            return <div />;
        }
        renderToStaticMarkup(<Probe />);
        // reloadCountRef is 0 on initial mount → base 5000ms + 0 * 2000 = 5000.
        expect(captured!.getPenpalTimeout()).toBe(5000);
    });
});
