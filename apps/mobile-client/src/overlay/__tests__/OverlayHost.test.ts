/**
 * Behavioural tests for the OverlayHost subscription contract.
 *
 * React-rendering the component requires `react-test-renderer` which isn't
 * installed, so we exercise the pure `subscribeOverlayPull` helper directly.
 * That helper carries the entire globalThis-subscription logic the
 * component's useEffect runs — asserting its correctness + OverlayHost's
 * render-prop branch is covered by the fakeRuntime.integration test.
 */

import { describe, expect, mock, test } from 'bun:test';

import {
    subscribeOverlayPull,
    type OverlayGlobals,
} from '../overlayHostSubscription';

describe('subscribeOverlayPull', () => {
    test('invokes pull once synchronously on subscribe (initial mount pull)', () => {
        const gt: OverlayGlobals = {};
        const pull = mock(() => {});
        const unsubscribe = subscribeOverlayPull(gt, pull);
        expect(pull).toHaveBeenCalledTimes(1);
        unsubscribe();
    });

    test('adds pull to globalThis._onlookOverlaySubscribers', () => {
        const gt: OverlayGlobals = {};
        const pull = () => {};
        const unsubscribe = subscribeOverlayPull(gt, pull);
        expect(gt._onlookOverlaySubscribers).toBeInstanceOf(Set);
        expect(gt._onlookOverlaySubscribers!.has(pull)).toBe(true);
        unsubscribe();
    });

    test('reuses existing subscribers Set when one is already present', () => {
        const existing = new Set<() => void>([() => {}]);
        const gt: OverlayGlobals = { _onlookOverlaySubscribers: existing };
        const pull = () => {};
        const unsubscribe = subscribeOverlayPull(gt, pull);
        expect(gt._onlookOverlaySubscribers).toBe(existing);
        expect(existing.has(pull)).toBe(true);
        unsubscribe();
    });

    test('cleanup removes pull from subscribers', () => {
        const gt: OverlayGlobals = {};
        const pull = () => {};
        const unsubscribe = subscribeOverlayPull(gt, pull);
        unsubscribe();
        expect(gt._onlookOverlaySubscribers!.has(pull)).toBe(false);
    });

    test('two OverlayHost-style subscriptions coexist on the shared Set', () => {
        const gt: OverlayGlobals = {};
        const pullA = mock(() => {});
        const pullB = mock(() => {});
        const unsubA = subscribeOverlayPull(gt, pullA);
        const unsubB = subscribeOverlayPull(gt, pullB);
        expect(gt._onlookOverlaySubscribers!.size).toBe(2);

        // Simulate renderApp notifying all subscribers.
        gt._onlookOverlaySubscribers!.forEach((fn) => fn());
        expect(pullA).toHaveBeenCalledTimes(2); // 1 initial + 1 notify
        expect(pullB).toHaveBeenCalledTimes(2);

        unsubA();
        unsubB();
        expect(gt._onlookOverlaySubscribers!.size).toBe(0);
    });

    test('cleanup tolerates missing subscribers Set (defensive guard)', () => {
        const gt: OverlayGlobals = {};
        const pull = () => {};
        const unsubscribe = subscribeOverlayPull(gt, pull);
        // Simulate some rogue code clearing the Set.
        gt._onlookOverlaySubscribers = undefined;
        expect(() => unsubscribe()).not.toThrow();
    });

    test('pull sees the current _onlookOverlayElement at invocation time', () => {
        const gt: OverlayGlobals = { _onlookOverlayElement: { type: 'View' } };
        let seen: unknown = 'unset';
        const pull = () => {
            seen = gt._onlookOverlayElement;
        };
        const unsubscribe = subscribeOverlayPull(gt, pull);
        expect(seen).toEqual({ type: 'View' });
        unsubscribe();
    });
});

