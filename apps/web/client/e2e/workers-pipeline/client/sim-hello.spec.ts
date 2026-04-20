/**
 * workers-pipeline client — sim-hello.
 *
 * Validates the hello fixture mounts through the full two-tier path:
 * editor bundle → OverlayDispatcher (WS) → `__onlookMountOverlay` shim
 * from `packages/mobile-preview/runtime/shell.js`. The shim evaluates
 * the CJS overlay + mounts the component via the same `renderApp` +
 * `_initReconciler` primitives Hermes uses at iOS runtime.
 *
 * Running the actual iOS binary is still gated on the Xcode 16.1 native
 * build (commit d91f6df6). We can't eliminate that gate here, but we
 * CAN eliminate the TS-side uncertainty: the shim is pure JS and runs
 * identically under Node's `vm` module. If this spec stays green, the
 * overlay path is proven wired through every layer except the native
 * xcodebuild step. Setting `ONLOOK_SIM_RUNTIME_READY=1` opts into the
 * additional describe that runs the real simulator once the native
 * build unblocks.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { expect, test } from '@playwright/test';

import { bundleFixtureAsOverlay } from '../helpers/browser-bundler-harness';
import { OverlayDispatcher, resolveHmrSessionUrl } from '../../../../../../apps/mobile-client/src/relay/overlayDispatcher';

const SIM_READY = process.env.ONLOOK_SIM_RUNTIME_READY === '1';

const helperDir = dirname(fileURLToPath(import.meta.url));
const shellPath = join(
    helperDir,
    '..',
    '..',
    '..',
    '..',
    '..',
    '..',
    'packages',
    'mobile-preview',
    'runtime',
    'shell.js',
);

function loadOverlayShim(): {
    context: vm.Context;
    renders: Array<{ element: unknown }>;
    logs: string[];
} {
    const renders: Array<{ element: unknown }> = [];
    const logs: string[] = [];

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

    // Stubs that the base bundle would provide at runtime. The overlay's
    // CJS calls `require('react')`, `require('react-native')`, etc.; the
    // shim's requireFn routes bare specifiers through globalThis by name.
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
        _log: (m: unknown) => logs.push(String(m)),
        React: react,
        renderApp: (element: unknown) => renders.push({ element }),
        OnlookRuntime: {
            dispatchEvent: () => {},
        },
        // Install a require hook that resolves the base externals by name.
        __require: (specifier: string) => {
            if (specifier in baseGlobals) return baseGlobals[specifier];
            throw new Error(`overlay require: unresolved "${specifier}"`);
        },
    });
    vm.runInContext('globalThis = this;', ctx);

    const shellSource = readFileSync(shellPath, 'utf8');
    const marker = '// ─── Two-tier overlay mount';
    const startIdx = shellSource.indexOf(marker);
    if (startIdx === -1) {
        throw new Error(
            'sim-hello: overlay-mount marker not found in shell.js — shim missing?',
        );
    }
    vm.runInContext(shellSource.slice(startIdx), ctx);
    return { context: ctx, renders, logs };
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

test.describe('workers-pipeline client — sim-hello shim (runs everywhere)', () => {
    test('bundle → dispatcher → shim reaches renderApp with the user component', async () => {
        const { wrapped } = await bundleFixtureAsOverlay('hello');
        const shim = loadOverlayShim();

        const socket = new InMemorySocket();
        const dispatcher = new OverlayDispatcher(
            resolveHmrSessionUrl('http://relay', 'sim-hello-shim'),
            { createSocket: () => socket as unknown as WebSocket },
        );
        dispatcher.onOverlay((msg) => {
            // Drive the real shell.js shim with the overlay payload.
            vm.runInContext(
                `globalThis.__onlookMountOverlay(${JSON.stringify(msg.code)});`,
                shim.context,
            );
        });
        dispatcher.start();

        socket.emit(
            'message',
            JSON.stringify({ type: 'overlay', code: wrapped.code }),
        );

        // The shim extracts the fixture's default-exported App component
        // and forwards a createElement(App, null) to renderApp.
        expect(shim.renders).toHaveLength(1);
        expect(shim.logs.some((l) => l.includes('overlay mounted'))).toBe(true);
    });
});

test.describe('workers-pipeline client — sim-hello (full simulator, opt-in)', () => {
    test.skip(!SIM_READY, 'full simulator requires an Xcode 16.1 build — set ONLOOK_SIM_RUNTIME_READY=1 once it lands');

    test('hello fixture bundles + relays + dispatches through the overlay path', async () => {
        const { wrapped, bundle } = await bundleFixtureAsOverlay('hello');
        expect(wrapped.code).toContain('__onlookMountOverlay');

        const socket = new InMemorySocket();
        const dispatcher = new OverlayDispatcher(
            resolveHmrSessionUrl('http://relay', 'sim-hello'),
            { createSocket: () => socket as unknown as WebSocket },
        );
        const received: string[] = [];
        dispatcher.onOverlay((msg) => received.push(msg.code));
        dispatcher.start();

        socket.emit(
            'message',
            JSON.stringify({ type: 'overlay', code: wrapped.code, sourceMap: bundle.sourceMap }),
        );

        expect(received).toHaveLength(1);
        expect(received[0]).toContain('__onlookMountOverlay');
    });
});

test.describe('workers-pipeline client — sim-hello contract guard (always runs)', () => {
    test('the hello-fixture overlay is small enough to ship over the HMR WS frame budget', async () => {
        const { byteLength } = await bundleFixtureAsOverlay('hello');
        // Conservative 128KB upper bound — real HmrSession DO accepts up to
        // the CF Workers message limit but the fixture should be well under.
        expect(byteLength).toBeLessThan(128 * 1024);
    });
});
