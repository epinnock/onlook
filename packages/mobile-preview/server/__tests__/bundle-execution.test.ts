/**
 * Execution-level sibling to build-runtime.regression.test.ts.
 *
 * The regression test asserts the built bundle *looks* right (static string
 * patterns). This test asserts the built bundle *behaves* right: we spin up a
 * `node:vm` context with just enough Hermes/Fabric stubs to let the bundle
 * evaluate end-to-end, then inspect the sandbox to confirm:
 *
 *   1. The runtime exposed the globals user code depends on
 *      (`React`, `React.createElement`, `renderApp`, `_initReconciler`,
 *       `RN$AppRegistry`, etc.) — proves the runtime actually ran.
 *
 *   2. The Metro module-shim internals (`__d`, `__r`, `__modules`) did NOT
 *      leak into the enclosing scope — proves the IIFE wrapping introduced in
 *      commit 40e0f2ec actually contains them at RUNTIME, not just in source.
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
 *   - __turboModuleProxy      — optional; shell falls through if missing, but
 *                                providing it as an empty object silences the
 *                                OnlookRuntimeInstaller/OnlookInspectorInstaller
 *                                warnings
 *   - performance, setTimeout, clearTimeout, MessageChannel, queueMicrotask,
 *     console, process — all polyfilled by the bundle's own preamble IIFE
 *     (build-runtime.ts lines 45-53), so we don't need to pre-stub them;
 *     the polyfills are gated by `typeof ... === 'undefined'` so they
 *     no-op if the VM already provides them.
 */
function buildSandbox(): Record<string, unknown> {
    const sandbox: Record<string, unknown> = {
        // Fabric UIManager stub — only registerEventHandler is called at
        // shell-eval time; createNode/appendChild/etc are reached later via
        // renderApp() which this test never invokes.
        nativeFabricUIManager: {
            registerEventHandler: () => {},
        },
        // Hermes-style log hook — shell's _log() is best-effort and
        // swallows throws, so even a throwing stub would be fine, but
        // a no-op keeps the test output clean.
        nativeLoggingHook: (_msg: string, _level: number) => {},
        // Metro-style registerCallableModule: shell calls this 3x eagerly
        // (HMRClient, RCTDeviceEventEmitter, RCTNativeAppEventEmitter).
        // Accepting and discarding is sufficient — we never dispatch callable
        // modules in this test.
        RN$registerCallableModule: (_name: string, _factory: () => unknown) => {},
        // TurboModule proxy — optional. Empty object satisfies the `typeof
        // proxy === 'object'` branch in shell.js without actually resolving
        // any native modules (OnlookRuntimeInstaller, WebSocketModule, etc).
        __turboModuleProxy: {},
    };
    return sandbox;
}

describe('bundle execution: runtime bootstraps and exposes public globals', () => {
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
    const sandbox = buildSandbox();
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

    test('sandbox.React is exposed as an object (runtime.js ran)', () => {
        expect(typeof sandbox.React).toBe('object');
        expect(sandbox.React).not.toBeNull();
    });

    test('sandbox.React.createElement is a function', () => {
        const React = sandbox.React as { createElement?: unknown } | undefined;
        expect(React).toBeDefined();
        expect(typeof React?.createElement).toBe('function');
    });

    test('sandbox.renderApp is a function (B13 shell / runtime exposure)', () => {
        expect(typeof sandbox.renderApp).toBe('function');
    });

    test('sandbox._initReconciler is a function (B13 shell / runtime exposure)', () => {
        // Complement to renderApp: the shell's RN$AppRegistry.runApplication
        // path calls _initReconciler before renderApp, so both must be wired.
        expect(typeof sandbox._initReconciler).toBe('function');
    });

    test('sandbox.RN$AppRegistry is exposed (shell ran)', () => {
        // Sanity: proves the shell finished executing; runApplication is the
        // entrypoint Expo Go invokes after the bundle loads.
        expect(typeof sandbox.RN$AppRegistry).toBe('object');
        const registry = sandbox.RN$AppRegistry as { runApplication?: unknown };
        expect(typeof registry?.runApplication).toBe('function');
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
