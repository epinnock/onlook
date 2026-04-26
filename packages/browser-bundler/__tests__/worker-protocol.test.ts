import { describe, expect, test } from 'bun:test';

import {
    BROWSER_BUNDLER_WORKER_ERROR_TYPE,
    BROWSER_BUNDLER_WORKER_REQUEST_TYPE,
    BROWSER_BUNDLER_WORKER_SUCCESS_TYPE,
    isBrowserBundlerWorkerErrorResponse,
    isBrowserBundlerWorkerRequest,
    isBrowserBundlerWorkerResponse,
    isBrowserBundlerWorkerSuccessResponse,
    normalizeBrowserBundlerError,
    parseBrowserBundlerWorkerRequest,
    parseBrowserBundlerWorkerResponse,
} from '../src/worker-protocol';

describe('browser bundler worker protocol', () => {
    test('parses a bundle request with CreateBrowserBundleOptionsInput-compatible payload', () => {
        const message = {
            type: BROWSER_BUNDLER_WORKER_REQUEST_TYPE,
            requestId: 'req-1',
            options: {
                entryPoint: '/src/App.tsx',
                files: [{ path: '/src/App.tsx', contents: 'export default null;' }],
                externalSpecifiers: ['react', 'react-native'],
                platform: 'ios',
                minify: false,
                sourcemap: true,
                wasmUrl: 'https://cdn.example.com/esbuild.wasm',
            },
        };

        expect(isBrowserBundlerWorkerRequest(message)).toBe(true);

        const parsed = parseBrowserBundlerWorkerRequest(message);
        expect(parsed).not.toBeNull();
        expect(parsed?.requestId).toBe('req-1');
        expect(parsed?.options.externalSpecifiers).toEqual(['react', 'react-native']);
    });

    test('parses a success response with bundle output', () => {
        const message = {
            type: BROWSER_BUNDLER_WORKER_SUCCESS_TYPE,
            requestId: 'req-1',
            code: 'module.exports = {};',
            sourceMap: '{}',
            warnings: [{ text: 'ok' }],
        };

        expect(isBrowserBundlerWorkerSuccessResponse(message)).toBe(true);
        expect(isBrowserBundlerWorkerResponse(message)).toBe(true);

        const parsed = parseBrowserBundlerWorkerResponse(message);
        expect(parsed?.type).toBe(BROWSER_BUNDLER_WORKER_SUCCESS_TYPE);
        if (parsed?.type !== BROWSER_BUNDLER_WORKER_SUCCESS_TYPE) throw new Error('expected success response');
        expect(parsed.code).toBe('module.exports = {};');
        expect(parsed.warnings).toEqual([{ text: 'ok' }]);
    });

    test('parses an error response with normalized error payload', () => {
        const message = {
            type: BROWSER_BUNDLER_WORKER_ERROR_TYPE,
            requestId: 'req-1',
            error: normalizeBrowserBundlerError(new Error('boom')),
        };

        expect(isBrowserBundlerWorkerErrorResponse(message)).toBe(true);

        const parsed = parseBrowserBundlerWorkerResponse(message);
        expect(parsed?.type).toBe(BROWSER_BUNDLER_WORKER_ERROR_TYPE);
        if (parsed?.type !== BROWSER_BUNDLER_WORKER_ERROR_TYPE) throw new Error('expected error response');
        expect(parsed.error.message).toBe('boom');
        expect(parsed.error.name).toBe('Error');
    });

    test('rejects malformed messages', () => {
        expect(isBrowserBundlerWorkerRequest({ type: 'bundle', requestId: '', options: {} })).toBe(
            false,
        );
        expect(isBrowserBundlerWorkerResponse({ type: 'bundle:success', requestId: 'req-1' })).toBe(
            false,
        );
        expect(parseBrowserBundlerWorkerRequest({ type: 'bundle', requestId: 'req-1' })).toBeNull();
        expect(parseBrowserBundlerWorkerResponse({ type: 'bundle:error', requestId: 'req-1' })).toBeNull();
    });

    test('normalizes non-Error throws into a stable shape', () => {
        expect(normalizeBrowserBundlerError('failed')).toEqual({
            name: 'Error',
            message: 'failed',
        });
        expect(normalizeBrowserBundlerError({ message: 'still failed', name: 'CustomError' })).toEqual({
            name: 'CustomError',
            message: 'still failed',
        });
    });
});
