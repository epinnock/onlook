/**
 * Execution-level sibling to build-runtime.regression.test.ts.
 *
 * The regression test asserts the built bundle *looks* right (static string
 * patterns). This test asserts the built bundle *behaves* right: we spin up a
 * `node:vm` context with just enough Hermes/Fabric stubs to let the bundle
 * evaluate end-to-end, then inspect the sandbox to confirm behaviour in both
 * paths the bundle supports:
 *
 *   1. Onlook Mobile Client mode (`globalThis.OnlookRuntime` pre-installed
 *      by the native JSI installer) — shell.js early-returns without running
 *      `bootstrapShell`, so `RN$AppRegistry` is NOT installed. runtime.js
 *      still runs (wire React + reconciler globals) so the wrap-eval-bundle
 *      can call `globalThis.renderApp(React.createElement(...))`. This is
 *      the gate that replaces the old `typeof window !== 'undefined'` check
 *      removed in commit 1269f58a.
 *
 *   2. Browser-preview / Expo Go mode (`OnlookRuntime` absent) — shell runs
 *      the full bootstrap (HMRClient / RCTDeviceEventEmitter / AppRegistry
 *      stubs), and runtime.js also runs. React + reconciler + `RN$AppRegistry`
 *      all exposed on the sandbox.
 *
 * In both paths runtime.js runs so React globals are always installed; the
 * Metro module shim internals (`__d`, `__r`, `__modules`) stay IIFE-contained.
 *
 * If `runtime/bundle.js` is missing (fresh clone, failed build), all tests
 * skip gracefully with a pointer to `bun run build:runtime`.
 *
 * NOTE: the shell (`runtime/shell.js`) hard-requires `nativeFabricUIManager`
 * and calls `RN$registerCallableModule` + friends eagerly. We stub exactly
 * those globals, and no more — deliberately mirroring the Hermes surface
 * Expo Go gives us. Any additional stubbing required to get past eval would
 * be a signal that the shell has grown a new native dep worth documenting;
 * see the comments on the sandbox builder below.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';

const BUNDLE_PATH = join(import.meta.dir, '..', '..', 'runtime', 'bundle.js');

/**
 * Build a fresh sandbox object with just enough Hermes/Fabric-shaped stubs
 * for shell.js + runtime.js to evaluate without throwing.
 *
 * Required stubs (determined by reading runtime/shell.js):
 *   - nativeFabricUIManager   — shell throws if missing; needs registerEventHandler
 *   - nativeLoggingHook       — shell's _log funnels through this
 *   - RN$registerCallableModule — shell registers HMRClient/RCTDeviceEventEmitter/etc
 *   - __turboModuleProxy      — optional; entry.js uses its presence to decide
 *                                whether to load runtime.js (Hermes skips it,
 *                                browser-preview loads it). Controlled by the
 *                                `hermes` arg so each describe block can cover
 *                                one path.
 *   - performance, setTimeout, clearTimeout, MessageChannel, queueMicrotask,
 *     console, process — all polyfilled by the bundle's own preamble IIFE
 *     (build-runtime.ts lines 45-53), so we don't need to pre-stub them;
 *     the polyfills are gated by `typeof ... === 'undefined'` so they
 *     no-op if the VM already provides them.
 */
function buildSandbox(onlookMobileClient: boolean): Record<string, unknown> {
    const sandbox: Record<string, unknown> = {
        // Fabric UIManager stub — only registerEventHandler is called at
        // shell-eval time (when bootstrap runs); createNode/appendChild/etc
        // are reached later via renderApp() which this test never invokes.
        nativeFabricUIManager: {
            registerEventHandler: () => {},
        },
        // Hermes-style log hook — shell's _log() is best-effort and swallows
        // throws; no-op keeps the test output clean.
        nativeLoggingHook: (_msg: string, _level: number) => {},
        // Metro-style registerCallableModule: bootstrap calls this 3x eagerly
        // (HMRClient, RCTDeviceEventEmitter, RCTNativeAppEventEmitter).
        // Accepting and discarding is sufficient — we never dispatch callable
        // modules in this test.
        RN$registerCallableModule: (_name: string, _factory: () => unknown) => {},
    };
    if (onlookMobileClient) {
        // Simulate the custom Onlook Mobile Client: its native JSI installer
        // sets `globalThis.OnlookRuntime` before user JS runs. shell.js gates
        // `bootstrapShell` on `!globalThis.OnlookRuntime`, so with it set the
        // bootstrap (HMRClient + RN$AppRegistry + friends) is skipped. runtime.js
        // still runs — React + reconciler + renderApp globals are installed so
        // user code's wrap-eval-bundle can find them.
        sandbox.OnlookRuntime = { version: 'stub' };
    } else {
        // Browser-preview / Expo Go path: OnlookRuntime is absent, so shell
        // bootstrap runs. runtime.js also runs. All React/reconciler/AppRegistry
        // globals end up on the sandbox.
        sandbox.window = sandbox;
    }
    return sandbox;
}

describe('bundle execution (Onlook Mobile Client mode): bootstrap skipped, runtime globals still installed', () => {
    if (!existsSync(BUNDLE_PATH)) {
        test.skip('bundle.js not built — run `bun run build:runtime` in packages/mobile-preview first', () => {
            /* skipped */
        });
        return;
    }

    const bundle = readFileSync(BUNDLE_PATH, 'utf8');

    // Evaluate once and share the resulting sandbox across assertions.
    // The bundle is ~260KB and eval is deterministic; re-evaluating per
    // test would triple runtime for no coverage gain.
    const sandbox = buildSandbox(true);
    const context = createContext(sandbox);

    let evalError: Error | null = null;
    try {
        runInContext(bundle, context, { filename: 'bundle.js', timeout: 5000 });
    } catch (err) {
        evalError = err instanceof Error ? err : new Error(String(err));
    }

    test('bundle evaluates without throwing', () => {
        if (evalError) {
            throw new Error(
                `bundle.js threw during eval: ${evalError.message}\n` +
                    `If a new native dep was added to shell.js, stub it in buildSandbox().\n` +
                    `Stack:\n${evalError.stack ?? '(no stack)'}`,
            );
        }
        expect(evalError).toBeNull();
    });

    // The following assertions are conditional on successful eval; if eval
    // failed we've already surfaced it above. We still run them so a single
    // failing build produces one actionable error rather than a cascade.

    test('sandbox.React is defined (runtime.js ran)', () => {
        // runtime.js always runs so user code's wrap-eval-bundle can find
        // React via `globalThis.React`. The Hermes "skip runtime.js" gate
        // from an earlier design was removed when we consolidated on the
        // keyed-render path — see ADR B13-fabric-reactTag-dedupe-keyed-render.
        expect(sandbox.React).toBeDefined();
    });

    test('sandbox.createElement is a function (runtime.js ran)', () => {
        expect(typeof sandbox.createElement).toBe('function');
    });

    test('sandbox.renderApp is a function (runtime.js ran)', () => {
        expect(typeof sandbox.renderApp).toBe('function');
    });

    test('sandbox._initReconciler is a function (runtime.js ran)', () => {
        expect(typeof sandbox._initReconciler).toBe('function');
    });

    test('sandbox.RN$AppRegistry is undefined (shell.js bootstrap skipped when OnlookRuntime present)', () => {
        // shell.js gates `bootstrapShell` on `!globalThis.OnlookRuntime`.
        // The custom Onlook Mobile Client pre-installs OnlookRuntime via
        // its native JSI installer, so bootstrap (which shadows RN's real
        // AppRegistry, HMRClient, RCTDeviceEventEmitter) is skipped.
        // main.jsbundle provides the real versions of those callable
        // modules.
        expect(sandbox.RN$AppRegistry).toBeUndefined();
    });

    // --- IIFE containment assertions ---------------------------------------
    // These are the execution-level counterparts to
    // build-runtime.regression.test.ts. The static test proves the source
    // *looks* wrapped; these prove the wrap actually prevents leakage into
    // the enclosing scope when the bundle runs.

    test('sandbox.__d is undefined (Metro module shim is IIFE-contained)', () => {
        expect(sandbox.__d).toBeUndefined();
    });

    test('sandbox.__r is undefined (Metro module shim is IIFE-contained)', () => {
        expect(sandbox.__r).toBeUndefined();
    });

    test('sandbox.__modules is undefined (Metro module shim is IIFE-contained)', () => {
        expect(sandbox.__modules).toBeUndefined();
    });
});

describe('bundle execution (browser-preview mode): runtime.js loads, React exposed', () => {
    if (!existsSync(BUNDLE_PATH)) {
        test.skip('bundle.js not built — run `bun run build:runtime` in packages/mobile-preview first', () => {
            /* skipped */
        });
        return;
    }

    const bundle = readFileSync(BUNDLE_PATH, 'utf8');

    // Sandbox without __turboModuleProxy — entry.js loads runtime.js, which
    // wires React + reconciler globals. This is the path browser-based preview
    // iframes take when no native RN bundle is present.
    const sandbox = buildSandbox(false);
    const context = createContext(sandbox);

    let evalError: Error | null = null;
    try {
        runInContext(bundle, context, { filename: 'bundle.js', timeout: 5000 });
    } catch (err) {
        evalError = err instanceof Error ? err : new Error(String(err));
    }

    test('bundle evaluates without throwing', () => {
        if (evalError) {
            throw new Error(
                `bundle.js threw during eval: ${evalError.message}\n` +
                    `If a new native dep was added to shell.js, stub it in buildSandbox().\n` +
                    `Stack:\n${evalError.stack ?? '(no stack)'}`,
            );
        }
        expect(evalError).toBeNull();
    });

    test('sandbox.React is defined (runtime.js ran)', () => {
        expect(sandbox.React).toBeDefined();
    });

    test('sandbox.createElement is a function (runtime.js ran)', () => {
        expect(typeof sandbox.createElement).toBe('function');
    });

    test('sandbox.renderApp is a function (runtime.js ran)', () => {
        expect(typeof sandbox.renderApp).toBe('function');
    });

    test('sandbox._initReconciler is a function (runtime.js ran)', () => {
        expect(typeof sandbox._initReconciler).toBe('function');
    });

    test('sandbox.RN$AppRegistry is exposed (shell.js ran)', () => {
        expect(typeof sandbox.RN$AppRegistry).toBe('object');
        const registry = sandbox.RN$AppRegistry as { runApplication?: unknown };
        expect(typeof registry?.runApplication).toBe('function');
    });

    // Same IIFE-containment guardrails as Hermes mode — the shim must stay
    // contained regardless of which require path entry.js takes.

    test('sandbox.__d is undefined (Metro module shim is IIFE-contained)', () => {
        expect(sandbox.__d).toBeUndefined();
    });

    test('sandbox.__r is undefined (Metro module shim is IIFE-contained)', () => {
        expect(sandbox.__r).toBeUndefined();
    });

    test('sandbox.__modules is undefined (Metro module shim is IIFE-contained)', () => {
        expect(sandbox.__modules).toBeUndefined();
    });
});
