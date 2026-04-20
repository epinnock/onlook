import { describe, expect, test } from 'bun:test';

import {
    DEFAULT_OVERLAY_MOUNT_GLOBAL,
    wrapOverlayCode,
} from '../src/wrap-overlay';

describe('wrapOverlayCode', () => {
    test('wraps CJS code in the base-bundle mount call', () => {
        const wrapped = wrapOverlayCode('module.exports = { ok: true };');

        expect(wrapped.code).toContain(DEFAULT_OVERLAY_MOUNT_GLOBAL);
        expect(wrapped.code).toContain(
            JSON.stringify('module.exports = { ok: true };'),
        );
        expect(wrapped.code.endsWith('\n')).toBe(true);
    });

    test('preserves sourcemap sidecar', () => {
        expect(
            wrapOverlayCode('module.exports = {};', { sourceMap: '{}' }).sourceMap,
        ).toBe('{}');
    });

    test('validates code and mount global', () => {
        expect(() => wrapOverlayCode(' ')).toThrow('non-empty');
        expect(() =>
            wrapOverlayCode('module.exports = {};', { mountGlobal: 'bad-name' }),
        ).toThrow('Invalid overlay mount global');
    });
});
