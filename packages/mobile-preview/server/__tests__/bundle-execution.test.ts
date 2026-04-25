/**
 * Execution-level sibling to build-runtime.regression.test.ts.
 *
 * The regression test asserts the built bundle *looks* right (static string
 * patterns). This test asserts the built bundle *behaves* right: we spin up a
 * `node:vm` context with just enough Hermes/Fabric stubs to let the bundle
 * evaluate end-to-end, then inspect the sandbox to confirm behaviour in both
 * paths the bundle supports:
 *
 *   1. Hermes mode (`__turboModuleProxy` defined) — runtime/entry.js skips
 *      `require('./runtime.js')`, so React + reconciler are NEVER wired onto
 *      the sandbox globals. Main.jsbundle's React is authoritative; see
 *      plans/post-mortems/2026-04-16-runtime-d-r-clobber.md.
 *
 *   2. Browser-preview mode (`__turboModuleProxy` absent) — runtime.js loads
 *      normally and exposes `React`, `createElement`, `renderApp`,
 *      `_initReconciler` on the sandbox.
 *
 * In both paths the shell runs (so `RN$AppRegistry` is defined) and the Metro
 * module shim internals (`__d`, `__r`, `__modules`) stay IIFE-contained.
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
function buildSandbox(hermes: boolean): Record<string, unknown> {
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
    };
    if (!hermes) {
        // Browser-preview path: `window` is defined. entry.js only loads
        // runtime.js when `typeof window !== 'undefined'`. In Hermes-mode
        // tests (hermes=true) we leave window absent, matching what the
        // runtime prelude sees in Hermes before InitializeCore runs.
        sandbox.window = sandbox;
    }
    return sandbox;
}

describe('bundle execution (Hermes mode): runtime.js skipped, React from main.jsbundle', () => {
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

    test('sandbox.React is undefined (runtime.js skipped in Hermes mode)', () => {
        // entry.js gates runtime.js on `typeof __turboModuleProxy === 'undefined'`.
        // With __turboModuleProxy present (Hermes), runtime.js never runs and
        // globalThis.React is never set — leaving main.jsbundle's React as the
        // sole copy. Prevents the dual-React hooks crash (useState of null).
        expect(sandbox.React).toBeUndefined();
    });

    test('sandbox.createElement is undefined (runtime.js skipped in Hermes mode)', () => {
        expect(sandbox.createElement).toBeUndefined();
    });

    test('sandbox.renderApp is undefined (runtime.js skipped in Hermes mode)', () => {
        // renderApp is exposed by runtime.js, which is skipped in Hermes.
        // RN's built-in Fabric reconciler handles rendering instead.
        expect(sandbox.renderApp).toBeUndefined();
    });

    test('sandbox._initReconciler is undefined (runtime.js skipped in Hermes mode)', () => {
        expect(sandbox._initReconciler).toBeUndefined();
    });

    test('sandbox.RN$AppRegistry shadow is installed by shell.js (harmless in Hermes)', () => {
        // shell.js at line ~229 unconditionally sets
        // `globalThis.RN$AppRegistry = { runApplication: ... }`. On device
        // this is shadowed by main.jsbundle's real AppRegistry which loads
        // first, so the shell's version is dead code. In this VM sandbox
        // there's no main.jsbundle to take precedence, so we observe the
        // shadow directly. Was previously asserted `toBeUndefined` based
        // on an incorrect comment claiming the B13 block was Hermes-gated;
        // shell.js has never actually had that gate.
        expect(sandbox.RN$AppRegistry).toBeDefined();
        expect(
            typeof (sandbox.RN$AppRegistry as { runApplication?: unknown })
                ?.runApplication,
        ).toBe('function');
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
