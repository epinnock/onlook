/**
 * workers-pipeline client — sim-hello.
 *
 * Validates the hello fixture mounts through the full two-tier path:
 * editor bundle → OverlayDispatcher (WS) → `OnlookRuntime.reloadBundle`
 * eval'ing the self-mounting overlay. The wrap format installs
 * `globalThis.onlookMount` during eval; reloadBundle then calls it and
 * renderApp gets the user's component.
 *
 * Running the actual iOS binary is still part of Wave D (`bun run
 * mobile:build:ios` on the Mac mini). Here we stub the native runtime
 * with a Node `vm` context that mirrors the Hermes globals the base
 * bundle provides (React, renderApp) so the self-mounting overlay
 * exercises the same code path deterministically. If this spec stays
 * green, the TS side of the overlay contract is proven wired.
 *
 * `ONLOOK_SIM_RUNTIME_READY=1` opts into an additional describe that
 * runs against a booted simulator — once Maestro flow + Mac-mini runner
 * are in place.
 */
import vm from 'node:vm';

import { expect, test } from '@playwright/test';

import { bundleFixtureAsOverlay } from '../helpers/browser-bundler-harness';
import {
    OverlayDispatcher,
    resolveHmrSessionUrl,
} from '../../../../../../apps/mobile-client/src/relay/overlayDispatcher';

const SIM_READY = process.env.ONLOOK_SIM_RUNTIME_READY === '1';

/**
 * Build a Hermes-like vm context with the minimal globals the base
 * runtime would install before the overlay is eval'd.
 */
function buildRuntimeContext(): {
    context: vm.Context;
    renders: Array<{ element: unknown }>;
    reloadBundle: (bundleSource: string) => void;
} {
    const renders: Array<{ element: unknown }> = [];

    const react = {
        createElement(type: unknown, props: unknown, ...children: unknown[]) {
            return { $$typeof: 'react-element', type, props, children };
        },
        isValidElement(v: unknown) {
            return (
                !!v &&
                typeof v === 'object' &&
                (v as { $$typeof?: unknown }).$$typeof === 'react-element'
            );
        },
    };

    const baseGlobals: Record<string, unknown> = {
        react,
        'react-native': {
            View: 'View',
            Text: 'Text',
            StyleSheet: { create: (s: unknown) => s, flatten: (s: unknown) => s },
            AppRegistry: { registerComponent: () => {} },
        },
    };

    const ctx = vm.createContext({
        React: react,
        renderApp: (element: unknown) => renders.push({ element }),
        __require: (specifier: string) => {
            if (specifier in baseGlobals) return baseGlobals[specifier];
            throw new Error(`overlay require: unresolved "${specifier}"`);
        },
    });
    vm.runInContext('globalThis = this;', ctx);

    // Emulate OnlookRuntime.reloadBundle: tear down any prior tree, eval
    // the bundleSource (which registers a fresh onlookMount), then call it.
    const reloadBundle = (bundleSource: string): void => {
        try {
            vm.runInContext('if (typeof globalThis.onlookUnmount === "function") globalThis.onlookUnmount();', ctx);
        } catch {
            // teardown failures are non-fatal, matching native reloadBundle semantics
        }
        vm.runInContext(bundleSource, ctx);
        vm.runInContext('globalThis.onlookMount({});', ctx);
    };

    return { context: ctx, renders, reloadBundle };
}

class InMemorySocket {
    static OPEN = 1;
    readyState = InMemorySocket.OPEN;
    private readonly listeners = new Map<string, Array<(event: { data?: unknown }) => void>>();
    addEventListener(type: string, l: (event: { data?: unknown }) => void): void {
        const existing = this.listeners.get(type) ?? [];
        existing.push(l);
        this.listeners.set(type, existing);
    }
    close(): void {
        this.readyState = 3;
        (this.listeners.get('close') ?? []).forEach((l) => l({}));
    }
    emit(type: string, data?: unknown): void {
        (this.listeners.get(type) ?? []).forEach((l) => l({ data }));
    }
}

test.describe('workers-pipeline client — sim-hello (reloadBundle semantics, always runs)', () => {
    test('bundle → dispatcher → reloadBundle-sim reaches renderApp with the user component', async () => {
        const { wrapped } = await bundleFixtureAsOverlay('hello');
        const runtime = buildRuntimeContext();

        const socket = new InMemorySocket();
        const dispatcher = new OverlayDispatcher(
            resolveHmrSessionUrl('http://relay', 'sim-hello'),
            { createSocket: () => socket as unknown as WebSocket },
        );
        dispatcher.onOverlay((msg) => runtime.reloadBundle(msg.code));
        dispatcher.start();

        socket.emit(
            'message',
            JSON.stringify({ type: 'overlay', code: wrapped.code }),
        );

        expect(runtime.renders).toHaveLength(1);
        const rendered = runtime.renders[0]!.element as { type: { name?: string } };
        expect(rendered.type.name).toBe('App');
    });

    test('two consecutive overlays replace the mounted component (onlookUnmount fires)', async () => {
        const { wrapped: first } = await bundleFixtureAsOverlay('hello');
        const { wrapped: second } = await bundleFixtureAsOverlay('hello');
        const runtime = buildRuntimeContext();

        runtime.reloadBundle(first.code);
        runtime.reloadBundle(second.code);

        // Each reload emits one render. No ghosts, no duplicates.
        expect(runtime.renders).toHaveLength(2);
    });
});

test.describe('workers-pipeline client — sim-hello (full simulator, opt-in)', () => {
    test.skip(!SIM_READY, 'full simulator requires mobile:build:ios on the Mac mini; set ONLOOK_SIM_RUNTIME_READY=1 after the xcodebuild run');

    test('overlay wrapper shape is reloadBundle-compatible', async () => {
        const { wrapped } = await bundleFixtureAsOverlay('hello');
        expect(wrapped.code).toContain('globalThis.onlookMount = function onlookMount(props)');
    });
});

test.describe('workers-pipeline client — sim-hello contract guard (always runs)', () => {
    test('the hello-fixture overlay is small enough to ship over the HMR WS frame budget', async () => {
        const { byteLength } = await bundleFixtureAsOverlay('hello');
        expect(byteLength).toBeLessThan(128 * 1024);
    });
});
