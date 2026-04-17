/**
 * Regression test for the Hermes module-system clobber bug.
 *
 * Bug (fixed in 40e0f2ec): build-runtime.ts emitted top-level
 *   var __modules = {};
 *   function __d(...) {...}
 *   function __r(...) {...}
 * which, when our runtime bundle was prepended onto Metro's `main.jsbundle`,
 * hoisted into Hermes's global scope and clobbered Metro's native module
 * system. Fabric host modules then failed to resolve and Expo Go crashed.
 *
 * Fix: wrap the Metro shim declarations in an IIFE so `__modules`/`__d`/`__r`
 * remain lexically scoped and never collide with Metro's globals.
 *
 * This test asserts the built bundle.js preserves that IIFE wrapping.
 */
import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const BUNDLE_PATH = join(import.meta.dir, '..', '..', 'runtime', 'bundle.js');

describe('build-runtime regression: Metro module shim must be IIFE-scoped', () => {
  if (!existsSync(BUNDLE_PATH)) {
    test.skip('bundle.js not built — run `bun run build:runtime` in packages/mobile-preview first', () => {
      /* skipped */
    });
    return;
  }

  const bundle = readFileSync(BUNDLE_PATH, 'utf8');
  const lines = bundle.split('\n');
  // Preamble lives in the first ~60 lines; that is where the polyfills and
  // Metro module shim are emitted by build-runtime.ts.
  const preamble = lines.slice(0, 60);

  test('Metro module shim declarations ARE present (sanity: runtime is still wired)', () => {
    // The declarations must still exist somewhere in the preamble — we only
    // forbid them at top-level. We verify the runtime is still assembled.
    const preambleText = preamble.join('\n');
    expect(preambleText).toMatch(/var __modules\s*=/);
    expect(preambleText).toMatch(/function __d\(/);
    expect(preambleText).toMatch(/function __r\(/);
  });

  test('line immediately preceding `var __modules` opens a bare IIFE', () => {
    // Fix signature: build-runtime.ts emits the Metro module shim directly
    // after a line consisting solely of `(function(){` (IIFE open with no
    // arguments). In the pre-fix bundle, the line above `var __modules` was
    // `})(typeof globalThis ... );` — the polyfill IIFE's closing invocation.
    // This is the single most reliable signature of the fix and the test
    // anchors on it.
    const shimLineIdx = preamble.findIndex((line) => /^var __modules\s*=/.test(line));
    expect(shimLineIdx).toBeGreaterThan(-1);
    expect(shimLineIdx).toBeGreaterThan(0);

    const prevLine = (preamble[shimLineIdx - 1] ?? '').trim();
    // Exact match against build-runtime.ts line 54 emission.
    expect(prevLine).toMatch(/^\(function\s*\(\s*\)\s*\{\s*$/);
  });

  test('bundle closes the module-system IIFE at end-of-file', () => {
    // Trailing `})();` closes the IIFE that build-runtime.ts opens around
    // the Metro module shim. Pre-fix bundles end with `__r(0);` instead.
    const trimmed = bundle.trimEnd();
    expect(trimmed.endsWith('})();')).toBe(true);
  });

  test('no top-level `function __d(` on any preamble line before the module-shim IIFE opens', () => {
    // Find the `(function(){` bare-IIFE line (the module-shim wrapper). Any
    // `function __d(` at column 0 before that point would be a regression —
    // it would mean __d was hoisted into the enclosing scope.
    const wrapperIdx = preamble.findIndex((line) => /^\(function\s*\(\s*\)\s*\{\s*$/.test(line));
    expect(wrapperIdx).toBeGreaterThan(-1);

    const before = preamble.slice(0, wrapperIdx);
    const hits = before.filter((line) => /^function __d\(/.test(line));
    expect(hits).toEqual([]);
  });

  test('no top-level `function __r(` on any preamble line before the module-shim IIFE opens', () => {
    const wrapperIdx = preamble.findIndex((line) => /^\(function\s*\(\s*\)\s*\{\s*$/.test(line));
    expect(wrapperIdx).toBeGreaterThan(-1);

    const before = preamble.slice(0, wrapperIdx);
    const hits = before.filter((line) => /^function __r\(/.test(line));
    expect(hits).toEqual([]);
  });

  test('bundle closes the module-system IIFE at end-of-file', () => {
    // Trailing `})();` (optionally followed by a newline) closes the IIFE
    // that build-runtime.ts opens around the Metro module shim.
    const trimmed = bundle.trimEnd();
    expect(trimmed.endsWith('})();')).toBe(true);
  });
});
