/**
 * Execution-level test for `runtime/bundle-client-only.js` — the slim bundle
 * shipped on the Onlook Mobile Client (MCG.8).
 *
 * Sibling to `bundle-execution.test.ts` which covers the full `bundle.js`.
 * Slim-bundle invariants (all divergences from the full bundle):
 *
 *   - Contains shell.js ONLY. `runtime.js` and its React + reconciler deps
 *     must be absent.
 *   - Evaluates cleanly under Hermes-mode stubs (the mobile-client's actual
 *     JS environment). entry-client-only.js has no runtime.js gate to begin
 *     with — runtime.js is excluded from this bundle entirely.
 *   - The shell's RN$AppRegistry compose-or-fresh-install + Metro
 *     module system stay IIFE-contained (same as the full bundle).
 *
 * If `runtime/bundle-client-only.js` is missing (fresh clone, failed build),
 * tests skip gracefully with a pointer to `bun run build:runtime:client-only`.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createContext, runInContext } from 'node:vm';

const BUNDLE_PATH = join(
    import.meta.dir,
    '..',
    '..',
    'runtime',
    'bundle-client-only.js',
);

function buildSandbox(): Record<string, unknown> {
    return {
        nativeFabricUIManager: {
            registerEventHandler: () => {},
        },
        nativeLoggingHook: (_msg: string, _level: number) => {},
        RN$registerCallableModule: (_name: string, _factory: () => unknown) => {},
    };
}

describe('bundle-client-only execution (Hermes mode): shell.js only, no React', () => {
    if (!existsSync(BUNDLE_PATH)) {
        test.skip('bundle-client-only.js not built — run `bun run build:runtime:client-only` in packages/mobile-preview first', () => {
            /* skipped */
        });
        return;
    }

    const bundle = readFileSync(BUNDLE_PATH, 'utf8');
    const bundleSize = statSync(BUNDLE_PATH).size;

    const sandbox = buildSandbox();
    const context = createContext(sandbox);

    test('slim bundle evaluates without throwing', () => {
        expect(() => runInContext(bundle, context)).not.toThrow();
    });

    test('slim bundle is substantially smaller than the full bundle', () => {
        const fullBundle = join(import.meta.dir, '..', '..', 'runtime', 'bundle.js');
        if (!existsSync(fullBundle)) {
            // Full bundle not built — skip the ratio check without failing.
            return;
        }
        const fullSize = statSync(fullBundle).size;
        // Target: slim bundle ≤ 20% of full. Actual savings ~97%.
        expect(bundleSize).toBeLessThan(fullSize * 0.2);
    });

    test('React is NOT on the sandbox (runtime.js is excluded from the slim bundle)', () => {
        expect(sandbox.React).toBeUndefined();
        expect(sandbox.createElement).toBeUndefined();
        expect(sandbox._initReconciler).toBeUndefined();
    });

    test('renderApp is NOT installed by the slim bundle (mobile-client index.js installs its own)', () => {
        // The full bundle's runtime.js sets `globalThis.renderApp` to its
        // reconciler-based version. The slim bundle must leave it
        // untouched so mobile-client's subscribable renderApp is the sole
        // definition (ADR finding #3).
        expect(sandbox.renderApp).toBeUndefined();
    });

    test('shell.js fresh-installs RN$AppRegistry on the sandbox when no host registry exists', () => {
        // The slim bundle still includes shell.js. shell.js's
        // RN$AppRegistry block compose-or-fresh-installs based on
        // whether a host registry already exists. The sandbox has
        // none, so shell.js fresh-installs its own. On a real device
        // (Expo Go SDK 54 bridgeless), the host's JSI-backed registry
        // is mutated in place — see bundle-execution.test.ts for the
        // full explanation of why mutating preserves the JSI binding
        // and why a wholesale overwrite red-boxed the sim.
        expect(sandbox.RN$AppRegistry).toBeDefined();
        expect(typeof (sandbox.RN$AppRegistry as { runApplication?: unknown }).runApplication).toBe(
            'function',
        );
    });

    test('_log is polyfilled on the sandbox by the bundle preamble', () => {
        expect(typeof sandbox._log).toBe('function');
    });

    test('Metro module internals stay IIFE-contained (no __d/__r/__modules leak)', () => {
        expect(sandbox.__d).toBeUndefined();
        expect(sandbox.__r).toBeUndefined();
        expect(sandbox.__modules).toBeUndefined();
    });

    test('globalThis._tryConnectWebSocket from shell.js IS exposed (relay WS is JS-managed)', () => {
        expect(typeof sandbox._tryConnectWebSocket).toBe('function');
    });
});
