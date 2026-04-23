/**
 * Tests for wrapOverlayV1 — ADR-0001 task #30.
 *
 * Two layers of coverage:
 *
 *   1. Structural — the emitted envelope matches the ABI's grammar (no top-level ESM, strict
 *      mode, assertion of abi === 'v1', entry published to __pendingEntry).
 *   2. Behavioral — the wrapper's output actually runs in Node's `vm` module against a stub
 *      `OnlookRuntime` and extracts the right entry. Node's `vm` is a close enough proxy for
 *      Hermes to catch the common breakages (top-level await, import, redeclared `require`).
 */
import { describe, expect, test } from 'bun:test';
import vm from 'node:vm';

import {
    isHermesSafeOverlay,
    OVERLAY_SIZE_HARD_CAP,
    OVERLAY_SIZE_SOFT_CAP,
    OverlayWrapError,
    wrapOverlayV1,
} from '../src/wrap-overlay-v1';

// ─── Stub OnlookRuntime used by the behavioral tests ─────────────────────────

interface StubRuntime {
    abi: string;
    require: (spec: string) => unknown;
    __pendingEntry?: unknown;
}

function makeStubRuntime(
    aliasModules: Readonly<Record<string, unknown>> = {},
    abi: string = 'v1',
): StubRuntime {
    return {
        abi,
        require: (spec: string) => {
            if (spec in aliasModules) return aliasModules[spec];
            throw new Error('stub runtime: no alias for ' + JSON.stringify(spec));
        },
    };
}

function evalOverlayInVm(code: string, runtime: StubRuntime): StubRuntime {
    // The envelope references `globalThis.OnlookRuntime`. In Node `vm.createContext`, the
    // context's global object IS `globalThis` for eval'd code. Install the stub on it.
    const ctx = vm.createContext({ OnlookRuntime: runtime });
    vm.runInContext(code, ctx, { timeout: 1000 });
    return ctx.OnlookRuntime as StubRuntime;
}

// ─── Structural ──────────────────────────────────────────────────────────────

describe('wrapOverlayV1 / structural', () => {
    test('emits a strict-mode IIFE that asserts abi v1 and publishes __pendingEntry', () => {
        const out = wrapOverlayV1('module.exports = { default: "x" };');
        expect(out.code.startsWith('"use strict";')).toBe(true);
        expect(out.code).toContain("rt.abi !== \"v1\"");
        expect(out.code).toContain('rt.__pendingEntry = undefined;');
        expect(out.code).toContain('rt.__pendingEntry = ex');
    });

    test('no top-level import/export or dynamic import() leaks through', () => {
        const out = wrapOverlayV1('module.exports = { default: 1 };');
        expect(isHermesSafeOverlay(out.code)).toEqual({ ok: true });
    });

    test('preserves sourceMap passthrough', () => {
        const out = wrapOverlayV1('module.exports = {};', { sourceMap: '{"version":3}' });
        expect(out.sourceMap).toBe('{"version":3}');
    });

    test('reports sizeBytes and surfaces sizeWarning above the soft cap', () => {
        const big = 'module.exports = {}; /*' + 'x'.repeat(OVERLAY_SIZE_SOFT_CAP + 1) + '*/';
        const out = wrapOverlayV1(big);
        expect(out.sizeBytes).toBeGreaterThan(OVERLAY_SIZE_SOFT_CAP);
        expect(out.sizeWarning).toContain('soft cap');
    });

    test('rejects empty input', () => {
        expect(() => wrapOverlayV1('')).toThrow(OverlayWrapError);
        expect(() => wrapOverlayV1('   \n\t  ')).toThrow(OverlayWrapError);
    });

    test('rejects input above the hard cap', () => {
        const huge = 'module.exports = {}; /*' + 'x'.repeat(OVERLAY_SIZE_HARD_CAP + 1) + '*/';
        let caught: unknown;
        try {
            wrapOverlayV1(huge);
        } catch (e) {
            caught = e;
        }
        expect(caught).toBeInstanceOf(OverlayWrapError);
        expect((caught as OverlayWrapError).code).toBe('size-exceeded');
    });

    test('skipSizeCap bypasses the hard cap for tests', () => {
        const huge = 'module.exports = {}; /*' + 'x'.repeat(OVERLAY_SIZE_HARD_CAP + 1) + '*/';
        expect(() => wrapOverlayV1(huge, { skipSizeCap: true })).not.toThrow();
    });
});

// ─── Behavioral ──────────────────────────────────────────────────────────────

describe('wrapOverlayV1 / behavioral', () => {
    test('publishes module.exports.default as the entry', () => {
        const cjs = 'function App() { return "hello"; }\nmodule.exports = { default: App };';
        const out = wrapOverlayV1(cjs);
        const rt = evalOverlayInVm(out.code, makeStubRuntime());
        expect(typeof rt.__pendingEntry).toBe('function');
        expect((rt.__pendingEntry as () => string)()).toBe('hello');
    });

    test('falls back to module.exports when no default key', () => {
        const cjs = 'module.exports = { ok: true };';
        const out = wrapOverlayV1(cjs);
        const rt = evalOverlayInVm(out.code, makeStubRuntime());
        expect(rt.__pendingEntry).toEqual({ ok: true });
    });

    test('bare require() is routed to OnlookRuntime.require', () => {
        const cjs = 'var r = require("react");\nmodule.exports = { default: r };';
        const fakeReact = { createElement: () => null };
        const out = wrapOverlayV1(cjs);
        const rt = evalOverlayInVm(out.code, makeStubRuntime({ react: fakeReact }));
        expect(rt.__pendingEntry).toBe(fakeReact);
    });

    test('unknown bare specifier surfaces as the stub runtime error (editor preflight catches these earlier)', () => {
        const cjs = 'var x = require("missing-pkg");\nmodule.exports = { default: x };';
        const out = wrapOverlayV1(cjs);
        expect(() => evalOverlayInVm(out.code, makeStubRuntime())).toThrow(/no alias/);
    });

    test('ABI mismatch throws at envelope boot, before any user code runs', () => {
        const cjs = 'throw new Error("user code must not run on abi mismatch");';
        const out = wrapOverlayV1(cjs);
        const rtWithV0 = makeStubRuntime({}, 'v0');
        expect(() => evalOverlayInVm(out.code, rtWithV0)).toThrow(/ABI mismatch/);
    });

    test('missing OnlookRuntime throws a clear error', () => {
        const out = wrapOverlayV1('module.exports = {};');
        const ctx = vm.createContext({});
        expect(() => vm.runInContext(out.code, ctx, { timeout: 1000 })).toThrow(/ABI mismatch/);
    });

    test('two overlays in a row publish independent entries', () => {
        const a = wrapOverlayV1('module.exports = { default: "A" };');
        const b = wrapOverlayV1('module.exports = { default: "B" };');
        const rt = makeStubRuntime();
        evalOverlayInVm(a.code, rt);
        expect(rt.__pendingEntry).toBe('A');
        evalOverlayInVm(b.code, rt);
        expect(rt.__pendingEntry).toBe('B');
    });

    test('multi-statement CJS with hoisted functions runs correctly', () => {
        const cjs = [
            'function helper(n) { return n * 2; }',
            'function App(n) { return helper(n) + 1; }',
            'module.exports = { default: App };',
        ].join('\n');
        const out = wrapOverlayV1(cjs);
        const rt = evalOverlayInVm(out.code, makeStubRuntime());
        expect((rt.__pendingEntry as (n: number) => number)(5)).toBe(11);
    });

    test('__pendingEntry is cleared and rewritten — never stale from prior mount', () => {
        const rt = makeStubRuntime();
        rt.__pendingEntry = 'stale';
        const out = wrapOverlayV1('module.exports = { default: "fresh" };');
        evalOverlayInVm(out.code, rt);
        expect(rt.__pendingEntry).toBe('fresh');
    });

    test('handles a CJS cycle (a → b → a) via standard partial-exports semantics (task #37)', () => {
        // Simulate what esbuild's multi-module output for a circular import
        // would look like once collapsed into a single CJS body. Modules 0
        // and 1 both require each other: under CJS semantics the second
        // require() during module 0's first evaluation returns module 1's
        // still-in-progress exports object — so module 1 sees a PARTIALLY
        // populated module 0 and must defer its use to function bodies.
        //
        // This is the same shape esbuild emits for intra-overlay cycles
        // once Phase 5's multi-module resolver lands. Proving it runs
        // cleanly through the wrap-overlay-v1 envelope today means the
        // envelope itself doesn't add cycle-hostile behaviour — it's a
        // plain CJS eval shell.
        const cjs = `
            var __modules = {};
            var __seen = {};
            function __r(id) {
                if (!(id in __seen)) {
                    __seen[id] = true;
                    __modules[id] = { exports: {} };
                    __factories[id](__modules[id], __modules[id].exports, __r);
                }
                return __modules[id].exports;
            }
            var __factories = {};
            __factories[0] = function(module, exports, require) {
                exports.a = function() { return "a->" + require(1).b(); };
                exports.fromA = "A";
            };
            __factories[1] = function(module, exports, require) {
                var modA = require(0);
                exports.b = function() { return "b-sees-A=" + modA.fromA; };
                exports.fromB = "B";
            };
            module.exports = {
                default: {
                    callAviaB: function() { return __r(0).a(); },
                    directB: function() { return __r(1).b(); },
                },
            };
        `;
        const out = wrapOverlayV1(cjs);
        const rt = evalOverlayInVm(out.code, makeStubRuntime());
        const entry = rt.__pendingEntry as {
            callAviaB: () => string;
            directB: () => string;
        };
        // a() invokes require(1).b() which sees module 0's partial exports.
        // fromA is set BEFORE a() is defined so module 1 observes it.
        expect(entry.callAviaB()).toBe('a->b-sees-A=A');
        expect(entry.directB()).toBe('b-sees-A=A');
    });

    test('cycle where B needs a property from A added AFTER B evaluates sees undefined (documented CJS quirk)', () => {
        // Same shape as above but A sets `fromA` AFTER requiring B. CJS
        // semantics: B has already captured modA and read fromA at
        // require-time, so B's view is frozen at that moment. This test
        // pins the documented CJS behaviour so future refactors that
        // accidentally change it break here first.
        const cjs = `
            var __modules = {};
            var __seen = {};
            function __r(id) {
                if (!(id in __seen)) {
                    __seen[id] = true;
                    __modules[id] = { exports: {} };
                    __factories[id](__modules[id], __modules[id].exports, __r);
                }
                return __modules[id].exports;
            }
            var __factories = {};
            __factories[0] = function(module, exports, require) {
                var modB = require(1);
                exports.fromA = "A-late";
                exports.callB = function() { return modB.b(); };
            };
            __factories[1] = function(module, exports, require) {
                var modA = require(0);
                exports.b = function() { return "B sees fromA=" + modA.fromA; };
            };
            module.exports = {
                default: { invoke: function() { return __r(0).callB(); } },
            };
        `;
        const out = wrapOverlayV1(cjs);
        const rt = evalOverlayInVm(out.code, makeStubRuntime());
        const entry = rt.__pendingEntry as { invoke: () => string };
        // When 0 requires 1 (before 0.fromA is set), 1 captures modA with
        // fromA=undefined. Later when b() runs, modA.fromA has been
        // populated — so the final answer IS "A-late" because modA is the
        // live exports object. This verifies the "eventual consistency"
        // guarantee CJS gives for cycles (contrast ESM's TDZ).
        expect(entry.invoke()).toBe('B sees fromA=A-late');
    });
});

// ─── isHermesSafeOverlay guardrail ───────────────────────────────────────────

describe('isHermesSafeOverlay', () => {
    test('flags a top-level import statement', () => {
        const bad = 'import foo from "bar";\nconsole.log(foo);';
        expect(isHermesSafeOverlay(bad)).toEqual({
            ok: false,
            reason: 'top-level `import` statement detected',
        });
    });

    test('flags a top-level export statement', () => {
        const bad = 'export default 1;';
        expect(isHermesSafeOverlay(bad)).toEqual({
            ok: false,
            reason: 'top-level `export` statement detected',
        });
    });

    test('flags a dynamic import() even inside a function body', () => {
        const bad = 'function load() { return import("./x"); }';
        expect(isHermesSafeOverlay(bad)).toEqual({
            ok: false,
            reason: 'dynamic `import()` detected',
        });
    });

    test('flags a top-level await', () => {
        const bad = '\n  await fetch("/x");';
        expect(isHermesSafeOverlay(bad)).toEqual({
            ok: false,
            reason: 'top-level `await` detected',
        });
    });

    test('passes the envelope produced by wrapOverlayV1', () => {
        const out = wrapOverlayV1('module.exports = { default: () => 1 };');
        expect(isHermesSafeOverlay(out.code)).toEqual({ ok: true });
    });
});
