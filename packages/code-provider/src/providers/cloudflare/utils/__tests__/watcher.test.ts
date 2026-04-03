import { describe, expect, it, mock } from 'bun:test';
import type { WatchEvent, WatchFilesInput } from '../../../../types';
import { CloudflareFileWatcher, type CloudflareSandboxWatchAPI } from '../watcher';

function createMockSandbox() {
    const unsubscribe = mock(() => {});
    let capturedCallback: ((event: WatchEvent) => void) | null = null;

    const sandbox: CloudflareSandboxWatchAPI = {
        files: {
            watch(_path, _options, callback) {
                capturedCallback = callback;
                return { unsubscribe };
            },
        },
    };

    return {
        sandbox,
        unsubscribe,
        emit(event: WatchEvent) {
            if (!capturedCallback) {
                throw new Error('Watcher not started — no callback captured');
            }
            capturedCallback(event);
        },
    };
}

function makeInput(path: string = '/workspace'): WatchFilesInput {
    return { args: { path } };
}

describe('CloudflareFileWatcher', () => {
    it('start() subscribes to the sandbox watcher', async () => {
        const { sandbox } = createMockSandbox();
        const watchSpy = mock(sandbox.files.watch);
        sandbox.files.watch = watchSpy;

        const watcher = new CloudflareFileWatcher(sandbox);
        await watcher.start(makeInput('/project'));

        expect(watchSpy).toHaveBeenCalledTimes(1);
        // First arg is the path
        expect(watchSpy.mock.calls[0]![0]).toBe('/project');
        // Second arg is options
        expect(watchSpy.mock.calls[0]![1]).toEqual({ recursive: undefined, excludes: [] });
        // Third arg is a callback function
        expect(typeof watchSpy.mock.calls[0]![2]).toBe('function');
    });

    it('stop() calls unsubscribe', async () => {
        const { sandbox, unsubscribe } = createMockSandbox();
        const watcher = new CloudflareFileWatcher(sandbox);

        await watcher.start(makeInput());
        await watcher.stop();

        expect(unsubscribe).toHaveBeenCalledTimes(1);
    });

    it('stop() is safe to call when not started', async () => {
        const { sandbox } = createMockSandbox();
        const watcher = new CloudflareFileWatcher(sandbox);

        // Should not throw
        await watcher.stop();
    });

    it('registerEventCallback receives forwarded events', async () => {
        const { sandbox, emit } = createMockSandbox();
        const watcher = new CloudflareFileWatcher(sandbox);

        const received: WatchEvent[] = [];
        watcher.registerEventCallback(async (event) => {
            received.push(event);
        });

        await watcher.start(makeInput());

        const event: WatchEvent = { type: 'add', paths: ['/workspace/file.ts'] };
        emit(event);

        expect(received).toHaveLength(1);
        expect(received[0]).toEqual(event);
    });

    it('multiple callbacks all fire', async () => {
        const { sandbox, emit } = createMockSandbox();
        const watcher = new CloudflareFileWatcher(sandbox);

        const received1: WatchEvent[] = [];
        const received2: WatchEvent[] = [];

        watcher.registerEventCallback(async (event) => {
            received1.push(event);
        });
        watcher.registerEventCallback(async (event) => {
            received2.push(event);
        });

        await watcher.start(makeInput());

        const event: WatchEvent = { type: 'change', paths: ['/workspace/index.ts'] };
        emit(event);

        expect(received1).toHaveLength(1);
        expect(received1[0]).toEqual(event);
        expect(received2).toHaveLength(1);
        expect(received2[0]).toEqual(event);
    });

    it('passes recursive and excludes options through', async () => {
        const { sandbox } = createMockSandbox();
        const watchSpy = mock(sandbox.files.watch);
        sandbox.files.watch = watchSpy;

        const watcher = new CloudflareFileWatcher(sandbox);
        await watcher.start({
            args: { path: '/workspace', recursive: true, excludes: ['node_modules'] },
        });

        expect(watchSpy.mock.calls[0]![1]).toEqual({
            recursive: true,
            excludes: ['node_modules'],
        });
    });
});
