/**
 * Integration test: fake OnlookRuntime + bundle-that-calls-renderApp.
 *
 * Wires together three pieces that separately have unit coverage but have
 * never been exercised end-to-end in bun:test:
 *   1. `installRenderAppBridge(globals)` installs the subscribable renderApp
 *      (normally in index.js).
 *   2. A fake `OnlookRuntime` with `abi: 'v1'` whose `mountOverlay(source,
 *      props)` `eval`s the source inside a closure that sees `globalThis`
 *      as our fake globals.
 *   3. A bundle body that calls `globalThis.renderApp({...})`.
 *
 * The on-device flow (qrToMount → OnlookRuntime.mountOverlay → eval'd
 * bundle → globalThis.renderApp → OverlayHost subscriber) is mirrored here
 * without native code. A passing test means future refactors that change any
 * one of those links will fail this test instead of silently bricking the
 * overlay pipeline.
 */

import { describe, expect, mock, test } from 'bun:test';

import {
    installRenderAppBridge,
    type RenderAppGlobals,
} from '../renderAppBridge';

type BundleGlobals = RenderAppGlobals & Record<string, unknown>;

function mountBundleInFakeRuntime(globals: BundleGlobals, source: string): void {
    // Mimic JSI mountOverlay: evaluate the source with a named `globalThis`
    // bound to our fake globals object. Real Hermes execution uses its own
    // realm; Function + explicit param achieves the same separation for a
    // pure-JS bundle body (no assets, no native modules).
    const run = new Function('globalThis', source);
    run(globals);
}

describe('fakeRuntime integration: mountOverlay → renderApp → subscriber', () => {
    test('subscriber fires with the rendered element', () => {
        const globals: BundleGlobals = {};
        installRenderAppBridge(globals);

        const subscriber = mock(() => {});
        globals._onlookOverlaySubscribers!.add(subscriber);

        const bundleSource = `
            globalThis.renderApp({
                type: 'View',
                props: { children: { type: 'Text', props: { children: 'hi' } } },
            });
        `;

        mountBundleInFakeRuntime(globals, bundleSource);

        expect(subscriber).toHaveBeenCalledTimes(1);
        const pushed = globals._onlookOverlayElement as {
            type: string;
            props: { children: { type: string; props: { children: string } } };
        };
        expect(pushed.type).toBe('View');
        expect(pushed.props.children.props.children).toBe('hi');
    });

    test('a bad-component tree is dropped — subscriber never notified', () => {
        const globals: BundleGlobals = {};
        installRenderAppBridge(globals);

        const subscriber = mock(() => {});
        globals._onlookOverlaySubscribers!.add(subscriber);

        const bundleSource = `
            globalThis.renderApp({ type: 'RCTRawText', props: { text: 'nope' } });
        `;

        mountBundleInFakeRuntime(globals, bundleSource);

        expect(subscriber).toHaveBeenCalledTimes(0);
        expect(globals._onlookOverlayElement).toBeUndefined();
    });

    test('two sequential mounts push two elements — ordering preserved', () => {
        const globals: BundleGlobals = {};
        installRenderAppBridge(globals);

        const seen: unknown[] = [];
        globals._onlookOverlaySubscribers!.add(() => {
            seen.push(globals._onlookOverlayElement);
        });

        mountBundleInFakeRuntime(
            globals,
            `globalThis.renderApp({ type: 'View', props: { children: 'hello' } });`,
        );
        mountBundleInFakeRuntime(
            globals,
            `globalThis.renderApp({ type: 'View', props: { children: 'UPDATED' } });`,
        );

        expect(seen.length).toBe(2);
        expect((seen[0] as { props: { children: string } }).props.children).toBe('hello');
        expect((seen[1] as { props: { children: string } }).props.children).toBe('UPDATED');
    });

    test('a bundle throwing after renderApp does not prevent the element from landing', () => {
        const globals: BundleGlobals = {};
        installRenderAppBridge(globals);
        const subscriber = mock(() => {});
        globals._onlookOverlaySubscribers!.add(subscriber);

        const bundleSource = `
            globalThis.renderApp({ type: 'View', props: { children: 'pre-throw' } });
            throw new Error('bundle boom');
        `;

        expect(() => mountBundleInFakeRuntime(globals, bundleSource)).toThrow(
            'bundle boom',
        );
        expect(subscriber).toHaveBeenCalledTimes(1);
        expect((globals._onlookOverlayElement as { props: { children: string } }).props.children).toBe(
            'pre-throw',
        );
    });
});
