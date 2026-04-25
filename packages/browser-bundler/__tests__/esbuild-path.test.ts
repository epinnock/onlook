import { describe, expect, test } from 'bun:test';

import {
    ESBUILD_WASM_PATH_GLOBAL_KEY,
    getEsbuildWasmPath,
    resolveEsbuildWasmPath,
    setEsbuildWasmPath,
} from '../src';

describe('esbuild wasm path resolver', () => {
    test('resolves an explicit string path', () => {
        expect(resolveEsbuildWasmPath({ path: '/assets/esbuild.wasm' })).toBe('/assets/esbuild.wasm');
    });

    test('normalizes explicit URL values', () => {
        expect(resolveEsbuildWasmPath({ path: new URL('/assets/esbuild.wasm', 'https://example.com/app/') })).toBe(
            'https://example.com/assets/esbuild.wasm',
        );
    });

    test('falls back to the provided default path', () => {
        expect(
            resolveEsbuildWasmPath({
                defaultPath: new URL('./esbuild.wasm', 'https://example.com/app/'),
            }),
        ).toBe('https://example.com/app/esbuild.wasm');
    });

    test('reads and writes the scoped global default', () => {
        const scope: Record<string, unknown> = {};

        expect(getEsbuildWasmPath({ scope })).toBeUndefined();
        expect(setEsbuildWasmPath('/runtime/esbuild.wasm', { scope })).toBe('/runtime/esbuild.wasm');
        expect(getEsbuildWasmPath({ scope })).toBe('/runtime/esbuild.wasm');
        expect(resolveEsbuildWasmPath({ scope })).toBe('/runtime/esbuild.wasm');
    });

    test('supports overriding the global key', () => {
        const scope: Record<string, unknown> = {};

        setEsbuildWasmPath('/runtime/esbuild.wasm', {
            scope,
            globalKey: 'customEsbuildWasmPath',
        });

        expect(getEsbuildWasmPath({ scope, globalKey: 'customEsbuildWasmPath' })).toBe('/runtime/esbuild.wasm');
        expect(scope[ESBUILD_WASM_PATH_GLOBAL_KEY]).toBeUndefined();
    });

    test('throws a clear error when no path is available', () => {
        expect(() => resolveEsbuildWasmPath({ scope: {} })).toThrow(
            'Missing esbuild-wasm browser asset URL',
        );
    });
});
