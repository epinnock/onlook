import { describe, expect, it, mock } from 'bun:test';
import type { WatchEvent } from '../../../../types';
import { SnackFileWatcher } from '../watcher';

function createMockSnack(initialFiles: Record<string, { contents: string }>) {
    let listener: ((state: { files: Record<string, { contents: string }> }) => void) | null = null;
    let files = { ...initialFiles };

    return {
        snack: {
            getState: () => ({ files }),
            addStateListener(cb: (state: { files: Record<string, { contents: string }> }) => void) {
                listener = cb;
                return {
                    remove() {
                        listener = null;
                    },
                };
            },
        },
        emit(newFiles: Record<string, { contents: string }>) {
            files = newFiles;
            listener?.({ files: newFiles });
        },
        get hasListener() {
            return listener !== null;
        },
    };
}

describe('SnackFileWatcher', () => {
    it('detects added files', async () => {
        const { snack, emit } = createMockSnack({
            'App.tsx': { contents: 'export default () => null' },
        });
        const watcher = new SnackFileWatcher(snack);
        const events: WatchEvent[] = [];
        watcher.registerEventCallback(async (event) => {
            events.push(event);
        });

        await watcher.start({ args: { path: '/' } });

        emit({
            'App.tsx': { contents: 'export default () => null' },
            'utils.ts': { contents: 'export const x = 1' },
        });

        expect(events).toHaveLength(1);
        expect(events[0].type).toBe('add');
        expect(events[0].paths).toEqual(['utils.ts']);
    });

    it('detects removed files', async () => {
        const { snack, emit } = createMockSnack({
            'App.tsx': { contents: 'export default () => null' },
            'utils.ts': { contents: 'export const x = 1' },
        });
        const watcher = new SnackFileWatcher(snack);
        const events: WatchEvent[] = [];
        watcher.registerEventCallback(async (event) => {
            events.push(event);
        });

        await watcher.start({ args: { path: '/' } });

        emit({
            'App.tsx': { contents: 'export default () => null' },
        });

        expect(events).toHaveLength(1);
        expect(events[0].type).toBe('remove');
        expect(events[0].paths).toEqual(['utils.ts']);
    });

    it('detects changed files', async () => {
        const { snack, emit } = createMockSnack({
            'App.tsx': { contents: 'export default () => null' },
        });
        const watcher = new SnackFileWatcher(snack);
        const events: WatchEvent[] = [];
        watcher.registerEventCallback(async (event) => {
            events.push(event);
        });

        await watcher.start({ args: { path: '/' } });

        emit({
            'App.tsx': { contents: 'export default () => <View />' },
        });

        expect(events).toHaveLength(1);
        expect(events[0].type).toBe('change');
        expect(events[0].paths).toEqual(['App.tsx']);
    });

    it('detects multiple event types in a single state change', async () => {
        const { snack, emit } = createMockSnack({
            'App.tsx': { contents: 'v1' },
            'old.ts': { contents: 'remove me' },
        });
        const watcher = new SnackFileWatcher(snack);
        const events: WatchEvent[] = [];
        watcher.registerEventCallback(async (event) => {
            events.push(event);
        });

        await watcher.start({ args: { path: '/' } });

        emit({
            'App.tsx': { contents: 'v2' },
            'new.ts': { contents: 'added' },
        });

        expect(events).toHaveLength(3);

        const add = events.find((e) => e.type === 'add');
        const remove = events.find((e) => e.type === 'remove');
        const change = events.find((e) => e.type === 'change');

        expect(add?.paths).toEqual(['new.ts']);
        expect(remove?.paths).toEqual(['old.ts']);
        expect(change?.paths).toEqual(['App.tsx']);
    });

    it('does not fire events when no files changed', async () => {
        const { snack, emit } = createMockSnack({
            'App.tsx': { contents: 'unchanged' },
        });
        const watcher = new SnackFileWatcher(snack);
        const events: WatchEvent[] = [];
        watcher.registerEventCallback(async (event) => {
            events.push(event);
        });

        await watcher.start({ args: { path: '/' } });

        emit({
            'App.tsx': { contents: 'unchanged' },
        });

        expect(events).toHaveLength(0);
    });

    it('stop() removes the state listener', async () => {
        const mockSnack = createMockSnack({
            'App.tsx': { contents: 'v1' },
        });
        const watcher = new SnackFileWatcher(mockSnack.snack);
        const events: WatchEvent[] = [];
        watcher.registerEventCallback(async (event) => {
            events.push(event);
        });

        await watcher.start({ args: { path: '/' } });
        expect(mockSnack.hasListener).toBe(true);

        await watcher.stop();
        expect(mockSnack.hasListener).toBe(false);

        mockSnack.emit({
            'App.tsx': { contents: 'v2' },
        });

        expect(events).toHaveLength(0);
    });

    it('fires all registered callbacks for each event', async () => {
        const { snack, emit } = createMockSnack({
            'App.tsx': { contents: 'v1' },
        });
        const watcher = new SnackFileWatcher(snack);

        const cb1 = mock(async (_event: WatchEvent) => {});
        const cb2 = mock(async (_event: WatchEvent) => {});
        watcher.registerEventCallback(cb1);
        watcher.registerEventCallback(cb2);

        await watcher.start({ args: { path: '/' } });

        emit({
            'App.tsx': { contents: 'v2' },
        });

        expect(cb1).toHaveBeenCalledTimes(1);
        expect(cb2).toHaveBeenCalledTimes(1);
    });

    it('tracks state across multiple emissions', async () => {
        const { snack, emit } = createMockSnack({
            'App.tsx': { contents: 'v1' },
        });
        const watcher = new SnackFileWatcher(snack);
        const events: WatchEvent[] = [];
        watcher.registerEventCallback(async (event) => {
            events.push(event);
        });

        await watcher.start({ args: { path: '/' } });

        // First change: add a file
        emit({
            'App.tsx': { contents: 'v1' },
            'new.ts': { contents: 'hello' },
        });

        expect(events).toHaveLength(1);
        expect(events[0].type).toBe('add');

        // Second change: modify the newly added file
        emit({
            'App.tsx': { contents: 'v1' },
            'new.ts': { contents: 'updated' },
        });

        expect(events).toHaveLength(2);
        expect(events[1].type).toBe('change');
        expect(events[1].paths).toEqual(['new.ts']);
    });
});
