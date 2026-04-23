/**
 * Unit tests for the subscribable renderApp bridge.
 *
 * Each test builds a fresh fake-global object to install against — this
 * mirrors the `gt = globalThis` pattern used by `index.js` and avoids
 * touching the real process-wide globals (which would leak between tests).
 */

import { describe, expect, mock, test } from 'bun:test';

import { installRenderAppBridge, type RenderAppGlobals } from '../renderAppBridge';

function makeGlobals(): RenderAppGlobals {
    return {};
}

describe('installRenderAppBridge', () => {
    test('creates a new subscribers Set when none exists', () => {
        const gt = makeGlobals();
        installRenderAppBridge(gt);
        expect(gt._onlookOverlaySubscribers).toBeInstanceOf(Set);
        expect(gt._onlookOverlaySubscribers!.size).toBe(0);
    });

    test('reuses an existing subscribers Set when one is already present', () => {
        const gt: RenderAppGlobals = {
            _onlookOverlaySubscribers: new Set([() => {}]),
        };
        const preExisting = gt._onlookOverlaySubscribers;
        installRenderAppBridge(gt);
        expect(gt._onlookOverlaySubscribers).toBe(preExisting);
        expect(gt._onlookOverlaySubscribers!.size).toBe(1);
    });

    test('installed renderApp stores the element and notifies subscribers', () => {
        const gt = makeGlobals();
        installRenderAppBridge(gt);
        const sub = mock(() => {});
        gt._onlookOverlaySubscribers!.add(sub);

        const element = { type: 'View', props: { children: 'hi' } };
        gt.renderApp!(element);
        expect(gt._onlookOverlayElement).toBe(element);
        expect(sub).toHaveBeenCalledTimes(1);
    });

    test('installed renderApp drops trees containing bad component strings', () => {
        const gt = makeGlobals();
        installRenderAppBridge(gt);
        const sub = mock(() => {});
        gt._onlookOverlaySubscribers!.add(sub);

        const badTree = { type: 'RCTRawText', props: {} };
        gt.renderApp!(badTree);
        expect(gt._onlookOverlayElement).toBeUndefined();
        expect(sub).toHaveBeenCalledTimes(0);
    });

    test('installed renderApp notifies multiple subscribers', () => {
        const gt = makeGlobals();
        installRenderAppBridge(gt);
        const a = mock(() => {});
        const b = mock(() => {});
        gt._onlookOverlaySubscribers!.add(a);
        gt._onlookOverlaySubscribers!.add(b);

        gt.renderApp!({ type: 'View', props: {} });
        expect(a).toHaveBeenCalledTimes(1);
        expect(b).toHaveBeenCalledTimes(1);
    });

    test('one subscriber throwing does not block the others', () => {
        const gt = makeGlobals();
        installRenderAppBridge(gt);
        const a = mock(() => {
            throw new Error('bad subscriber');
        });
        const b = mock(() => {});
        gt._onlookOverlaySubscribers!.add(a);
        gt._onlookOverlaySubscribers!.add(b);

        gt.renderApp!({ type: 'View', props: {} });
        expect(a).toHaveBeenCalledTimes(1);
        expect(b).toHaveBeenCalledTimes(1);
    });

    test('pins renderApp via defineProperty writable:false', () => {
        const gt = makeGlobals();
        const result = installRenderAppBridge(gt);
        expect(result.pinned).toBe(true);

        const originalFn = gt.renderApp;
        // Attempting to overwrite should fail silently in non-strict mode
        // or throw in strict — either way, the pinned function survives.
        try {
            (gt as { renderApp?: unknown }).renderApp = () => {};
        } catch {
            // strict-mode throw is acceptable
        }
        expect(gt.renderApp).toBe(originalFn);
    });

    test('regression: a second defineProperty call by runtime.js-style clobber cannot replace the pinned fn', () => {
        // Simulates `packages/mobile-preview/runtime/runtime.js`'s Fabric
        // host-config redefining `globalThis.renderApp` after our bridge
        // was installed. Pinning with writable:false, configurable:false
        // must cause that redefine to throw (strict) or silently fail
        // (non-strict). Either way, our original function survives.
        const gt = makeGlobals();
        const result = installRenderAppBridge(gt);
        expect(result.pinned).toBe(true);
        const original = gt.renderApp;

        const clobber = () => {};
        let threw = false;
        try {
            Object.defineProperty(gt, 'renderApp', {
                value: clobber,
                writable: true,
                configurable: true,
            });
        } catch {
            threw = true;
        }
        expect(gt.renderApp).toBe(original);
        expect(threw).toBe(true);
    });

    test('regression: plain-assignment clobber also cannot replace the pinned fn', () => {
        const gt = makeGlobals();
        installRenderAppBridge(gt);
        const original = gt.renderApp;

        try {
            (gt as { renderApp?: unknown }).renderApp = () => {};
        } catch {
            // Strict-mode throw is acceptable; behaviour we care about is
            // that the original function is still reachable.
        }
        expect(gt.renderApp).toBe(original);
    });

    test('falls back to plain assignment when defineProperty throws', () => {
        const gt = makeGlobals();
        // Simulate a global where defineProperty is unavailable (rare but
        // defensive — the sealed or frozen case returns pinned:false).
        Object.defineProperty(gt, 'renderApp', {
            value: () => {
                throw new Error('pre-sealed');
            },
            writable: false,
            configurable: false,
        });

        const result = installRenderAppBridge(gt);
        expect(result.pinned).toBe(false);
        // Must still return a callable renderApp on the result object even
        // when the pin failed — callers fall back to the returned reference.
        expect(typeof result.renderApp).toBe('function');
    });
});
