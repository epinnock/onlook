/**
 * Overlay-mount contract tests.
 *
 * The previous implementation installed a `globalThis.__onlookMountOverlay`
 * shim in `shell.js`. That was reverted 2026-04-20 — the two-tier overlay
 * now ships as a self-mounting bundle (see
 * `packages/browser-bundler/src/wrap-overlay.ts`) that `OnlookRuntime.reloadBundle`
 * evaluates directly. This spec validates the self-mounting contract in a
 * Hermes-like vm context with the exact globals the base runtime exposes.
 */
import { describe, expect, test } from 'bun:test';
import vm from 'node:vm';

import { wrapOverlayCode } from '../../../browser-bundler/src/wrap-overlay';

interface HarnessContext {
    readonly context: vm.Context;
    readonly renders: Array<{ element: unknown }>;
    /** Mirrors the native `OnlookRuntime.reloadBundle(bundleSource)` contract. */
    reloadBundle: (bundleSource: string) => void;
    /** Test escape hatch — install arbitrary globals (e.g. missing React). */
    set: (key: string, value: unknown) => void;
    /** Returns the currently-registered `globalThis.onlookMount`. */
    getInstalledMount: () => unknown;
}

function buildRuntime(
    overrides: {
        withReact?: boolean;
        withRenderApp?: boolean;
        withRequire?: boolean;
    } = {},
): HarnessContext {
    const withReact = overrides.withReact ?? true;
    const withRenderApp = overrides.withRenderApp ?? true;
    const withRequire = overrides.withRequire ?? true;

    const renders: Array<{ element: unknown }> = [];
    const react = withReact
        ? {
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
          }
        : undefined;

    const baseModules: Record<string, unknown> = {
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
        renderApp: withRenderApp
            ? (element: unknown) => renders.push({ element })
            : undefined,
        __require: withRequire
            ? (specifier: string) => {
                  if (specifier in baseModules) return baseModules[specifier];
                  throw new Error(`overlay require: unresolved "${specifier}"`);
              }
            : undefined,
    });
    vm.runInContext('globalThis = this;', ctx);

    const reloadBundle = (bundleSource: string): void => {
        try {
            vm.runInContext(
                'if (typeof globalThis.onlookUnmount === "function") globalThis.onlookUnmount();',
                ctx,
            );
        } catch {
            /* non-fatal per native reloadBundle contract */
        }
        vm.runInContext(bundleSource, ctx);
        vm.runInContext('globalThis.onlookMount({});', ctx);
    };

    return {
        context: ctx,
        renders,
        reloadBundle,
        set(key, value) {
            vm.runInContext(`globalThis[${JSON.stringify(key)}] = arguments[0];`, ctx, {
                // no-op; value injection below via runInContext with bind
            } as vm.RunningScriptOptions);
            vm.runInContext(
                `globalThis[${JSON.stringify(key)}] = __$inject_value;`,
                Object.assign(ctx, { __$inject_value: value }),
            );
        },
        getInstalledMount() {
            return vm.runInContext('globalThis.onlookMount', ctx);
        },
    };
}

describe('wrapOverlayCode (self-mounting contract)', () => {
    test('installs globalThis.onlookMount that renders the default-exported component', () => {
        const { code } = wrapOverlayCode(
            `
                module.exports.default = function TestApp() {
                    return { $$typeof: 'react-element', type: 'View', props: {}, children: [] };
                };
            `,
        );
        const runtime = buildRuntime();
        runtime.reloadBundle(code);
        expect(runtime.renders).toHaveLength(1);
        const rendered = runtime.renders[0]!.element as { type: { name?: string } };
        expect(rendered.type.name).toBe('TestApp');
    });

    test('tags the mount with __isOverlayMount=true so diagnostics can distinguish it', () => {
        const { code } = wrapOverlayCode(
            'module.exports.default = function() { return null; };',
        );
        const runtime = buildRuntime();
        vm.runInContext(code, runtime.context);
        const installed = runtime.getInstalledMount() as {
            __isOverlayMount?: unknown;
        };
        expect(installed.__isOverlayMount).toBe(true);
    });

    test('falls back to module.exports when there is no .default', () => {
        const { code } = wrapOverlayCode(
            `module.exports = function App() {
                return { $$typeof: 'react-element', type: 'View', props: {}, children: [] };
            };`,
        );
        const runtime = buildRuntime();
        runtime.reloadBundle(code);
        expect(runtime.renders).toHaveLength(1);
    });

    test('throws through reloadBundle when React is missing in the runtime', () => {
        const { code } = wrapOverlayCode('module.exports.default = function() { return null; };');
        const runtime = buildRuntime({ withReact: false });
        expect(() => runtime.reloadBundle(code)).toThrow(/globalThis\.React missing/);
    });

    test('throws when renderApp is missing (base runtime not booted)', () => {
        const { code } = wrapOverlayCode('module.exports.default = function() { return null; };');
        const runtime = buildRuntime({ withRenderApp: false });
        expect(() => runtime.reloadBundle(code)).toThrow(/globalThis\.renderApp missing/);
    });

    test('throws when the default export is not a component or element', () => {
        const { code } = wrapOverlayCode('module.exports = { not: "a component" };');
        const runtime = buildRuntime();
        expect(() => runtime.reloadBundle(code)).toThrow(/default export is not a component/);
    });

    test('overlay require routes bare specifiers through __require (base-external contract)', () => {
        // The test shape: overlay factory imports a base-external and
        // uses its shape. If the require hook isn't routed, `factory(...)`
        // throws during CJS eval — so reaching renders[0] at all proves
        // the require() worked.
        const { code } = wrapOverlayCode(
            `
                var RN = require('react-native');
                if (!RN || typeof RN.StyleSheet.create !== 'function') {
                    throw new Error('overlay: require("react-native") returned wrong shape');
                }
                module.exports.default = function App() {
                    return { $$typeof: 'react-element', type: 'RNView', props: {}, children: [] };
                };
            `,
        );
        const runtime = buildRuntime();
        runtime.reloadBundle(code);
        expect(runtime.renders).toHaveLength(1);
        // Factory type is the App function itself (React.createElement
        // captures it; instantiation happens in the reconciler later).
        expect(typeof (runtime.renders[0]!.element as { type: unknown }).type).toBe('function');
    });

    test('overlay eval fails loudly when require() cannot resolve a specifier', () => {
        const { code } = wrapOverlayCode(
            `
                require('not-a-base-external');
                module.exports.default = function() { return null; };
            `,
        );
        const runtime = buildRuntime();
        expect(() => runtime.reloadBundle(code)).toThrow(/unresolved "not-a-base-external"/);
    });

    test('wrapOverlayCode throws on empty input', () => {
        expect(() => wrapOverlayCode('')).toThrow(/non-empty/);
        expect(() => wrapOverlayCode('   ')).toThrow(/non-empty/);
    });

    test('emits legacy IIFE shape when emitSelfMounting=false', () => {
        const { code } = wrapOverlayCode('module.exports = {};', { emitSelfMounting: false });
        expect(code).toContain('__onlookMountOverlay');
        expect(code).toMatch(/^\s*\(function\(\)\s*\{/);
    });
});
