/**
 * ABI v1 overlay wrapper — two-tier-overlay-v2 task #30.
 *
 * Emits a Hermes-safe CJS IIFE compatible with
 * `globalThis.OnlookRuntime.mountOverlay(source)` per ADR-0001 §"Overlay source format".
 *
 * The input is a single CJS module string as produced by esbuild with:
 *   - `format: 'cjs'`
 *   - `platform: 'neutral'`
 *   - `external: [...alias-map entries...]`
 *
 * esbuild collapses multi-file user code into one module; bare imports become literal
 * `require("spec")` calls that the wrapper re-targets at `OnlookRuntime.require`. Relative
 * imports between user files are bundled by esbuild before this wrapper sees the code, so
 * the overlay itself is always a single CJS module — module id 0 of ADR-0001.
 *
 * Contract with `OnlookRuntime.mountOverlay`:
 *   1. Wrapper emits `"use strict";` + a self-executing IIFE.
 *   2. IIFE asserts `OnlookRuntime.abi === 'v1'` before any user code runs.
 *   3. IIFE binds `module`, `exports`, `require` locals; runs user CJS inline.
 *   4. IIFE publishes the entry (default export or module.exports) as
 *      `globalThis.OnlookRuntime.__pendingEntry`.
 *   5. `mountOverlay` reads `__pendingEntry`, clears it, mounts via AppRegistry.
 *
 * Hermes-safety (enforced by tests):
 *   - No top-level `import`, `export`, or dynamic `import()` in wrapper or user CJS.
 *   - No top-level `await`.
 *   - ES5.1 strict-mode `var`/`function` only at the wrapper's top level.
 *   - No reference to `window`, `document`, or other browser globals.
 *   - No `new Function(...)` — user CJS is syntactically inlined so Hermes parses the whole
 *     overlay as one AST. Size cap per ADR §"Performance envelope": 512 KB soft, 2 MB hard.
 */

import { ABI_VERSION, type AbiVersion } from '@onlook/mobile-client-protocol';

/** Soft warning above this size (bytes). Hard error above {@link OVERLAY_SIZE_HARD_CAP}. */
export const OVERLAY_SIZE_SOFT_CAP = 512 * 1024;
export const OVERLAY_SIZE_HARD_CAP = 2 * 1024 * 1024;

/** Performance budget targets from ADR-0001 §"Performance envelope". */
export const OVERLAY_BUILD_SLOW_MS = 1000;
export const OVERLAY_EVAL_TARGET_MS = 100;

export interface WrapOverlayV1Options {
    /** Source map for the pre-wrap CJS. Passed through unchanged to the envelope output. */
    readonly sourceMap?: string;
    /**
     * Override the target ABI string. Defaults to {@link ABI_VERSION}. Exposed so tests can
     * exercise mismatch paths; production consumers should not set this.
     */
    readonly abi?: AbiVersion;
    /**
     * When true, skip the size-cap check. Used by tests that intentionally pass large inputs.
     * Production consumers should leave this false.
     */
    readonly skipSizeCap?: boolean;
}

export interface WrappedOverlayV1 {
    readonly code: string;
    readonly sourceMap?: string;
    readonly sizeBytes: number;
    /** Non-null when {@link OVERLAY_SIZE_SOFT_CAP} < input ≤ {@link OVERLAY_SIZE_HARD_CAP}. */
    readonly sizeWarning?: string;
}

export class OverlayWrapError extends Error {
    constructor(
        message: string,
        public readonly code: 'empty-input' | 'size-exceeded',
    ) {
        super(message);
        this.name = 'OverlayWrapError';
    }
}

/**
 * Wrap a CJS module string in the ABI v1 self-evaluating envelope.
 *
 * The returned {@link WrappedOverlayV1.code} is what the editor sends as the `source` field of
 * an `overlayUpdate` WS message. The mobile client's `OnlookRuntime.mountOverlay(source)`
 * indirect-eval's it, then reads `OnlookRuntime.__pendingEntry` for the mount.
 */
export function wrapOverlayV1(
    cjsCode: string,
    options: WrapOverlayV1Options = {},
): WrappedOverlayV1 {
    const trimmed = cjsCode.trim();
    if (trimmed.length === 0) {
        throw new OverlayWrapError(
            'wrapOverlayV1: overlay CJS must be a non-empty string',
            'empty-input',
        );
    }

    const sizeBytes = Buffer.byteLength(cjsCode, 'utf8');
    if (!options.skipSizeCap && sizeBytes > OVERLAY_SIZE_HARD_CAP) {
        throw new OverlayWrapError(
            `wrapOverlayV1: overlay size ${sizeBytes} bytes exceeds hard cap ${OVERLAY_SIZE_HARD_CAP}`,
            'size-exceeded',
        );
    }

    const sizeWarning =
        sizeBytes > OVERLAY_SIZE_SOFT_CAP && sizeBytes <= OVERLAY_SIZE_HARD_CAP
            ? `overlay size ${sizeBytes} bytes exceeds soft cap ${OVERLAY_SIZE_SOFT_CAP} — expect >100ms eval on device`
            : undefined;

    const abi = options.abi ?? ABI_VERSION;

    // The envelope is written as raw text, not a template literal with interpolation, so the
    // CJS code body is syntactically inlined (Hermes parses everything as one AST). Any bare
    // `require(...)` calls in the CJS resolve to the local `require` binding below, which
    // forwards to `OnlookRuntime.require`.
    const code =
        '"use strict";\n' +
        '(function () {\n' +
        '  var rt = (typeof globalThis !== "undefined" ? globalThis : this).OnlookRuntime;\n' +
        '  if (!rt || rt.abi !== ' + JSON.stringify(abi) + ') {\n' +
        '    throw new Error("overlay: OnlookRuntime ABI mismatch (expected ' + abi + ')");\n' +
        '  }\n' +
        '  rt.__pendingEntry = undefined;\n' +
        '  var module = { exports: {} };\n' +
        '  var exports = module.exports;\n' +
        '  var require = function (spec) { return rt.require(spec); };\n' +
        '  // ----- user CJS (single module; esbuild-bundled) -----\n' +
        cjsCode +
        (cjsCode.endsWith('\n') ? '' : '\n') +
        '  // ----- end user CJS -----\n' +
        '  var ex = module.exports;\n' +
        '  rt.__pendingEntry = ex && (ex.default != null ? ex.default : ex);\n' +
        '})();\n';

    return {
        code,
        sourceMap: options.sourceMap,
        sizeBytes,
        sizeWarning,
    };
}

/**
 * Static check: is this overlay source free of top-level ES module syntax?
 *
 * Used by tests (#36 "no-top-level-ESM"). NOT a substitute for a parser — it catches the
 * common failure modes (a stray `import` statement or dynamic `import()` from a
 * mis-configured esbuild) without pulling in a full AST tool. False positives only occur
 * when a string literal in user code contains the regex match; those should be rare in
 * well-formed transpiler output.
 */
export function isHermesSafeOverlay(wrappedCode: string): { ok: true } | { ok: false; reason: string } {
    // Top-level imports — esbuild should never emit these when format:'cjs', but if somebody
    // mis-configures the build we want to catch it before the overlay hits a device.
    const topLevelImport = /(^|\n)\s*import\s+[\w{*][^'"\n]*from\s*['"]/;
    if (topLevelImport.test(wrappedCode)) {
        return { ok: false, reason: 'top-level `import` statement detected' };
    }
    const topLevelExport = /(^|\n)\s*export\s+(default|\{|const|let|var|function|class)/;
    if (topLevelExport.test(wrappedCode)) {
        return { ok: false, reason: 'top-level `export` statement detected' };
    }
    // Dynamic import — `import()` is a syntax error in Hermes even inside a function body.
    const dynamicImport = /\bimport\s*\(/;
    if (dynamicImport.test(wrappedCode)) {
        return { ok: false, reason: 'dynamic `import()` detected' };
    }
    // Top-level await — the envelope's IIFE is not async, so any raw `await` at scope 0 would
    // be a parse error, but inside the IIFE an `await` would also fail (non-async function).
    // This regex approximates: an `await` preceded by newline + whitespace only (not inside an
    // obvious `async function`/`async =>` preamble on the same line).
    const topLevelAwait = /(^|\n)\s*await\s+/;
    if (topLevelAwait.test(wrappedCode)) {
        return { ok: false, reason: 'top-level `await` detected' };
    }
    return { ok: true };
}
