import { describe, expect, test } from 'bun:test';

import { wrapOverlayCode } from '../src/wrap-overlay';

describe('wrapOverlayCode', () => {
    test('emits a self-mounting bundle that installs globalThis.onlookMount', () => {
        const wrapped = wrapOverlayCode('module.exports = { ok: true };');

        expect(wrapped.code).toContain('globalThis.onlookMount = function onlookMount(props)');
        expect(wrapped.code).toContain(JSON.stringify('module.exports = { ok: true };'));
        expect(wrapped.code).toContain('globalThis.renderApp(element)');
        expect(wrapped.code.endsWith('\n')).toBe(true);
    });

    test('preserves sourcemap sidecar', () => {
        expect(
            wrapOverlayCode('module.exports = {};', { sourceMap: '{}' }).sourceMap,
        ).toBe('{}');
    });

    test('rejects empty / whitespace-only input', () => {
        expect(() => wrapOverlayCode(' ')).toThrow(/non-empty/);
        expect(() => wrapOverlayCode('')).toThrow(/non-empty/);
    });

    test('emitSelfMounting=false falls back to the legacy IIFE shape', () => {
        const wrapped = wrapOverlayCode('module.exports = {};', {
            emitSelfMounting: false,
        });
        expect(wrapped.code).toContain('__onlookMountOverlay');
        expect(wrapped.code).toMatch(/^\s*\(function\(\)\s*\{/);
    });
});
