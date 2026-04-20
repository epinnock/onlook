import { describe, expect, test } from 'bun:test';

import {
    BROWSER_BUNDLER_WORKER_ERROR_TYPE,
    BROWSER_BUNDLER_WORKER_REQUEST_TYPE,
    BROWSER_BUNDLER_WORKER_SUCCESS_TYPE,
} from '../src/worker-protocol';
import {
    createBrowserBundlerWorkerRuntime,
    handleBrowserBundlerWorkerMessage,
    handleParsedBrowserBundlerWorkerRequest,
    type BrowserBundlerWorkerDependencies,
    type BrowserBundlerWorkerResponse,
} from '../src/worker';

describe('browser bundler worker runtime', () => {
    test('returns a success response for a bundle request', async () => {
        const dependencies = createDependencies(async () => ({
                outputFiles: [
                    { path: 'out.js', text: 'module.exports = {};' },
                    { path: 'out.js.map', text: '{"version":3}' },
                ],
                warnings: [{ text: 'ok' }],
            }));

        const response = await handleParsedBrowserBundlerWorkerRequest(
            {
                type: BROWSER_BUNDLER_WORKER_REQUEST_TYPE,
                requestId: 'req-1',
                options: {
                    entryPoint: '/src/App.tsx',
                    files: [{ path: '/src/App.tsx', contents: 'export default null;' }],
                    externalSpecifiers: ['react'],
                    sourcemap: true,
                },
            },
            dependencies,
        );

        expect(response).toEqual({
            type: BROWSER_BUNDLER_WORKER_SUCCESS_TYPE,
            requestId: 'req-1',
            code: 'module.exports = {};',
            sourceMap: '{"version":3}',
            warnings: [{ text: 'ok' }],
        });
    });

    test('returns an error response when bundling fails', async () => {
        const dependencies = createDependencies(async () => {
                throw new Error('boom');
            });

        const response = await handleParsedBrowserBundlerWorkerRequest(
            {
                type: BROWSER_BUNDLER_WORKER_REQUEST_TYPE,
                requestId: 'req-2',
                options: {
                    entryPoint: '/src/App.tsx',
                    files: [{ path: '/src/App.tsx', contents: 'export default null;' }],
                    externalSpecifiers: ['react'],
                },
            },
            dependencies,
        );

        expect(response).toEqual({
            type: BROWSER_BUNDLER_WORKER_ERROR_TYPE,
            requestId: 'req-2',
            error: {
                name: 'Error',
                message: 'boom',
                stack: expect.any(String),
            },
        });
    });

    test('ignores invalid messages without posting a response', async () => {
        const posted: BrowserBundlerWorkerResponse[] = [];
        const runtime = createBrowserBundlerWorkerRuntime(
            createDependencies(async () => {
                    throw new Error('should not be called');
                }),
            (message) => {
                posted.push(message);
            },
        );

        expect(
            await handleBrowserBundlerWorkerMessage(
                { type: 'bundle', requestId: '', options: {} },
                createDependencies(async () => {
                        throw new Error('should not be called');
                    }),
            ),
        ).toBeNull();

        await runtime.handleEvent({ data: { type: 'bundle:unknown' } });
        expect(posted).toEqual([]);
    });
});

function createDependencies(
    build: BrowserBundlerWorkerDependencies['esbuild']['build'],
): BrowserBundlerWorkerDependencies {
    return {
        esbuild: {
            build,
        },
    };
}
