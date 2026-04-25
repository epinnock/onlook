/**
 * Execution-level sibling to build-runtime.regression.test.ts.
 *
 * The regression test asserts the built bundle *looks* right (static string
 * patterns). This test asserts the built bundle *behaves* right: we spin up a
 * `node:vm` context with just enough Hermes/Fabric stubs to let the bundle
 * evaluate end-to-end, then inspect the sandbox to confirm behaviour in both
 * paths the bundle supports:
 *
 *   1. Onlook Mobile Client mode (`__noOnlookRuntime = true`) — runtime/entry.js
 *      skips `require('./runtime.js')`, so React + reconciler are NEVER wired
 *      onto the sandbox globals. Main.jsbundle's React is authoritative; see
 *      plans/post-mortems/2026-04-16-runtime-d-r-clobber.md.
 *
 *   2. Default mode (Expo Go or browser-preview, flag unset) — runtime.js loads
 *      and exposes `React`, `createElement`, `renderApp`, `_initReconciler`
 *      on the sandbox so shell.js's RN$AppRegistry.runApplication can mount.
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
 *   - __noOnlookRuntime       — entry.js gates runtime.js on `!__noOnlookRuntime`.
 *                                Set true to simulate the Onlook Mobile Client
 *                                path (skips runtime.js); leave unset to
 *                                simulate Expo Go / browser-preview (loads
 *                                runtime.js). Controlled by the `mobileClient`
 *                                arg so each describe block can cover one path.
 *   - performance, setTimeout, clearTimeout, MessageChannel, queueMicrotask,
 *     console, process — all polyfilled by the bundle's own preamble IIFE
 *     (build-runtime.ts lines 45-53), so we don't need to pre-stub them;
 *     the polyfills are gated by `typeof ... === 'undefined'` so they
 *     no-op if the VM already provides them.
 */
function buildSandbox(mobileClient: boolean): Record<string, unknown> {
    const sandbox: Record<string, unknown> = {
        nativeFabricUIManager: {
            registerEventHandler: () => {},
        },
        nativeLoggingHook: (_msg: string, _level: number) => {},
        RN$registerCallableModule: (_name: string, _factory: () => unknown) => {},
    };
    if (mobileClient) {
        sandbox.__noOnlookRuntime = true;
    }
    return sandbox;
}

describe('bundle execution (Onlook Mobile Client mode): runtime.js skipped, React from main.jsbundle', () => {
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

    test('sandbox.React is undefined (runtime.js skipped via __noOnlookRuntime)', () => {
        // entry.js gates runtime.js on `!globalThis.__noOnlookRuntime`. With
        // the flag set true (mobile-client path), runtime.js never runs and
        // globalThis.React is never set — leaving main.jsbundle's React as
        // the sole copy. Prevents the dual-React hooks crash.
        expect(sandbox.React).toBeUndefined();
    });

    test('sandbox.createElement is undefined (runtime.js skipped via __noOnlookRuntime)', () => {
        expect(sandbox.createElement).toBeUndefined();
    });

    test('sandbox.renderApp is undefined (runtime.js skipped via __noOnlookRuntime)', () => {
        // renderApp is exposed by runtime.js, which is skipped here. The
        // mobile-client installs its own pinned `globalThis.renderApp` via
        // `apps/mobile-client/index.js` before the bundle evaluates.
        expect(sandbox.renderApp).toBeUndefined();
    });

    test('sandbox._initReconciler is undefined (runtime.js skipped via __noOnlookRuntime)', () => {
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

describe('bundle execution (Expo Go / browser-preview default mode): runtime.js loads, React exposed', () => {
    if (!existsSync(BUNDLE_PATH)) {
        test.skip('bundle.js not built — run `bun run build:runtime` in packages/mobile-preview first', () => {
            /* skipped */
        });
        return;
    }

    const bundle = readFileSync(BUNDLE_PATH, 'utf8');

    // Sandbox without __noOnlookRuntime — entry.js loads runtime.js, which
    // wires React + reconciler globals. This is the path Expo Go and the
    // browser-based preview iframe take when the host hasn't opted out.
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
