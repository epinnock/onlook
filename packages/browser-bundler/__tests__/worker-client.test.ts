import { describe, expect, test } from 'bun:test';

import {
    BROWSER_BUNDLER_WORKER_ERROR_TYPE,
    BROWSER_BUNDLER_WORKER_SUCCESS_TYPE,
} from '../src/worker-protocol';
import { createBrowserBundlerWorkerClient, type BrowserBundlerWorkerLike } from '../src/worker-client';

describe('createBrowserBundlerWorkerClient', () => {
    test('posts a bundle request and resolves on a matching success response', async () => {
        const worker = createFakeWorker();
        const client = createBrowserBundlerWorkerClient(worker, {
            createRequestId: () => 'req-1',
        });

        const promise = client.bundle({
            entryPoint: '/src/App.tsx',
            files: [{ path: '/src/App.tsx', contents: 'export default null;' }],
            externalSpecifiers: ['react'],
        });

        expect(worker.messages).toEqual([
            {
                type: 'bundle',
                requestId: 'req-1',
                options: {
                    entryPoint: '/src/App.tsx',
                    files: [{ path: '/src/App.tsx', contents: 'export default null;' }],
                    externalSpecifiers: ['react'],
                },
            },
        ]);

        worker.dispatch({
            type: BROWSER_BUNDLER_WORKER_SUCCESS_TYPE,
            requestId: 'req-1',
            code: 'module.exports = {};',
            sourceMap: '{}',
            warnings: [{ text: 'ok' }],
        });

        await expect(promise).resolves.toEqual({
            code: 'module.exports = {};',
            sourceMap: '{}',
            warnings: [{ text: 'ok' }],
        });

        client.dispose();
    });

    test('rejects on a matching error response', async () => {
        const worker = createFakeWorker();
        const client = createBrowserBundlerWorkerClient(worker, {
            createRequestId: () => 'req-2',
        });

        const promise = client.bundle({
            entryPoint: '/src/App.tsx',
            files: [{ path: '/src/App.tsx', contents: 'export default null;' }],
            externalSpecifiers: ['react'],
        });

        worker.dispatch({
            type: BROWSER_BUNDLER_WORKER_ERROR_TYPE,
            requestId: 'req-2',
            error: {
                name: 'Error',
                message: 'boom',
                stack: 'stack-trace',
            },
        });

        await expect(promise).rejects.toMatchObject({
            name: 'Error',
            message: 'boom',
            stack: 'stack-trace',
        });

        client.dispose();
    });

    test('ignores responses for unrelated requestIds', async () => {
        const worker = createFakeWorker();
        const client = createBrowserBundlerWorkerClient(worker, {
            createRequestId: () => 'req-3',
        });

        const promise = client.bundle({
            entryPoint: '/src/App.tsx',
            files: [{ path: '/src/App.tsx', contents: 'export default null;' }],
            externalSpecifiers: ['react'],
        });

        let settled = false;
        promise.finally(() => {
            settled = true;
        });

        worker.dispatch({
            type: BROWSER_BUNDLER_WORKER_SUCCESS_TYPE,
            requestId: 'req-other',
            code: 'ignored',
            warnings: [],
        });

        await Promise.resolve();
        expect(settled).toBe(false);

        worker.dispatch({
            type: BROWSER_BUNDLER_WORKER_SUCCESS_TYPE,
            requestId: 'req-3',
            code: 'module.exports = {};',
            warnings: [],
        });

        await expect(promise).resolves.toEqual({
            code: 'module.exports = {};',
            warnings: [],
        });

        client.dispose();
    });
});

function createFakeWorker(): BrowserBundlerWorkerLike & {
    readonly messages: unknown[];
    dispatch(message: unknown): void;
} {
    const listeners = new Set<(event: { readonly data: unknown }) => void>();
    const messages: unknown[] = [];

    return {
        messages,
        postMessage(message: unknown) {
            messages.push(message);
        },
        addEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void) {
            if (type !== 'message') {
                return;
            }

            listeners.add(listener);
        },
        removeEventListener(type: 'message', listener: (event: { readonly data: unknown }) => void) {
            if (type !== 'message') {
                return;
            }

            listeners.delete(listener);
        },
        dispatch(message: unknown) {
            for (const listener of listeners) {
                listener({ data: message });
            }
        },
    };
}
