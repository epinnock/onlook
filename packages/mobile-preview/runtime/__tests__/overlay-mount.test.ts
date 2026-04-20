/**
 * Tests for the `__onlookMountOverlay` shim installed by shell.js.
 *
 * Loads the ES5-era shell.js source into a fresh vm context populated with
 * a minimal Hermes-like globalThis (React stub, renderApp stub, _log
 * capture), then drives the overlay-mount function end-to-end.
 *
 * Goals:
 *   - prove the CJS-string → component → renderApp path works in Node
 *     (same semantics Hermes will run at iOS runtime).
 *   - exercise the error paths (empty string, missing React, bad export).
 *   - confirm the error-dispatch routes through OnlookRuntime.dispatchEvent.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { describe, expect, test } from 'bun:test';

const helperDir = dirname(fileURLToPath(import.meta.url));
const shellPath = join(helperDir, '..', 'shell.js');
const shellSource = readFileSync(shellPath, 'utf8');

interface RenderCall {
    readonly element: unknown;
}

interface HarnessContext {
    readonly globals: Record<string, unknown>;
    readonly logs: string[];
    readonly renders: RenderCall[];
    readonly dispatchedEvents: Array<{ name: string; payload: unknown }>;
    runOverlay: (cjsCode: string) => void;
}

function buildHarness(
    overrides: { withReact?: boolean; withRenderApp?: boolean; withRuntime?: boolean } = {},
): HarnessContext {
    const withReact = overrides.withReact ?? true;
    const withRenderApp = overrides.withRenderApp ?? true;
    const withRuntime = overrides.withRuntime ?? true;

    const logs: string[] = [];
    const renders: RenderCall[] = [];
    const dispatchedEvents: Array<{ name: string; payload: unknown }> = [];

    // Minimal React stub — shell.js only uses createElement + isValidElement.
    const React = withReact
        ? {
              createElement(type: unknown, props: unknown, ...children: unknown[]) {
                  return { $$typeof: 'react-element', type, props, children };
              },
              isValidElement(value: unknown): boolean {
                  return (
                      !!value &&
                      typeof value === 'object' &&
                      (value as { $$typeof?: unknown }).$$typeof === 'react-element'
                  );
              },
          }
        : undefined;

    const ctx = vm.createContext({
        console: {
            log(...args: unknown[]) {
                // shell.js uses nativeLoggingHook via a local _log shim; we
                // intercept through _log by installing one into the context.
                logs.push(args.map(String).join(' '));
            },
        },
        // shell.js calls _log(...) at module-scope; install a capture.
        _log: (message: unknown) => logs.push(String(message)),
        globalThis: undefined as unknown,
        React,
        renderApp: withRenderApp
            ? (element: unknown) => {
                  renders.push({ element });
              }
            : undefined,
        OnlookRuntime: withRuntime
            ? {
                  dispatchEvent(name: string, payload: unknown) {
                      dispatchedEvents.push({ name, payload });
                  },
              }
            : undefined,
    });
    // shell.js references `globalThis` directly; wire the sandbox root as its own globalThis.
    vm.runInContext('globalThis = this;', ctx);

    // Only evaluate the overlay-mount block (the full shell.js requires
    // RN $AppRegistry / fab / reconciler scaffolding we don't need here).
    // Find the marker comment and eval from there to end of file.
    const marker = '// ─── Two-tier overlay mount';
    const startIdx = shellSource.indexOf(marker);
    if (startIdx === -1) {
        throw new Error('marker not found in shell.js — test out of date?');
    }
    const overlayBlock = shellSource.slice(startIdx);
    vm.runInContext(overlayBlock, ctx);

    const runOverlay = (cjsCode: string): void => {
        vm.runInContext(
            `globalThis.__onlookMountOverlay(${JSON.stringify(cjsCode)});`,
            ctx,
        );
    };

    return {
        globals: ctx as unknown as Record<string, unknown>,
        logs,
        renders,
        dispatchedEvents,
        runOverlay,
    };
}

describe('__onlookMountOverlay (shell.js shim)', () => {
    test('evaluates CJS + renders the default-exported component via renderApp', () => {
        const harness = buildHarness();
        const cjs = `
            module.exports.default = function TestApp() {
                return { $$typeof: 'react-element', type: 'View', props: {}, children: [] };
            };
        `;
        harness.runOverlay(cjs);
        expect(harness.renders).toHaveLength(1);
        const rendered = harness.renders[0]!.element as { type: unknown };
        expect((rendered as { type: { name?: string } }).type.name).toBe('TestApp');
        expect(harness.logs.some((l) => l.includes('overlay mounted'))).toBe(true);
    });

    test('falls back to module.exports when there is no default export', () => {
        const harness = buildHarness();
        const cjs = `
            module.exports = function App() {
                return { $$typeof: 'react-element', type: 'View', props: {}, children: [] };
            };
        `;
        harness.runOverlay(cjs);
        expect(harness.renders).toHaveLength(1);
    });

    test('logs + short-circuits on empty cjsCode without calling renderApp', () => {
        const harness = buildHarness();
        harness.runOverlay('');
        expect(harness.renders).toHaveLength(0);
        expect(harness.logs.some((l) => l.includes('empty cjsCode'))).toBe(true);
    });

    test('logs + short-circuits when renderApp is missing', () => {
        const harness = buildHarness({ withRenderApp: false });
        const cjs = `module.exports.default = function() { return {}; };`;
        harness.runOverlay(cjs);
        expect(harness.logs.some((l) => l.includes('renderApp missing'))).toBe(true);
    });

    test('logs + short-circuits when React is missing', () => {
        const harness = buildHarness({ withReact: false });
        const cjs = `module.exports.default = function() { return {}; };`;
        harness.runOverlay(cjs);
        expect(harness.renders).toHaveLength(0);
        expect(harness.logs.some((l) => l.includes('React missing'))).toBe(true);
    });

    test('dispatches onlook:error via OnlookRuntime when the overlay throws', () => {
        const harness = buildHarness();
        const cjs = `throw new Error('overlay boom');`;
        harness.runOverlay(cjs);
        expect(harness.renders).toHaveLength(0);
        expect(harness.dispatchedEvents).toHaveLength(1);
        expect(harness.dispatchedEvents[0]!.name).toBe('onlook:error');
        const payload = harness.dispatchedEvents[0]!.payload as { kind: string; message: string };
        expect(payload.kind).toBe('overlay-mount');
        expect(payload.message).toContain('overlay boom');
    });

    test('survives a throwing dispatchEvent (error path must never re-throw)', () => {
        const harness = buildHarness();
        // Replace dispatchEvent with one that throws.
        vm.runInContext(
            `globalThis.OnlookRuntime.dispatchEvent = function(){ throw new Error('dispatch exploded'); };`,
            harness.globals as unknown as vm.Context,
        );
        const cjs = `throw new Error('original failure');`;
        expect(() => harness.runOverlay(cjs)).not.toThrow();
    });

    test('exposes the require shim for base-external lookups', () => {
        const harness = buildHarness();
        vm.runInContext(
            `globalThis['react-native'] = { View: 'RNView' };`,
            harness.globals as unknown as vm.Context,
        );
        const cjs = `
            const RN = require('react-native');
            module.exports.default = function App() {
                return { $$typeof: 'react-element', type: RN.View, props: {}, children: [] };
            };
        `;
        harness.runOverlay(cjs);
        expect(harness.renders).toHaveLength(1);
        const rendered = harness.renders[0]!.element as { type: { name?: string } };
        expect(rendered.type.name).toBe('App');
    });
});
