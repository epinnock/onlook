import { describe, expect, it, mock } from 'bun:test';
import {
    CloudflareBackgroundCommand,
    CloudflareTask,
    CloudflareTerminal,
    type CloudflareSdkCommand,
    type CloudflareSdkTask,
    type CloudflareSdkTerminal,
} from '../terminal';

// ---------------------------------------------------------------------------
// Helpers — mock factory functions
// ---------------------------------------------------------------------------

function createMockTerminal(overrides?: Partial<CloudflareSdkTerminal>): CloudflareSdkTerminal {
    return {
        id: 'term-1',
        name: 'shell',
        open: mock(() => Promise.resolve('term-1')),
        write: mock(() => Promise.resolve()),
        run: mock(() => Promise.resolve()),
        kill: mock(() => Promise.resolve()),
        onOutput: mock(() => ({ dispose: mock(() => {}) })),
        ...overrides,
    };
}

function createMockTask(overrides?: Partial<CloudflareSdkTask>): CloudflareSdkTask {
    return {
        id: 'task-dev',
        name: 'dev',
        command: 'bun run dev',
        open: mock(() => Promise.resolve('task-dev')),
        run: mock(() => Promise.resolve()),
        restart: mock(() => Promise.resolve()),
        stop: mock(() => Promise.resolve()),
        onOutput: mock(() => ({ dispose: mock(() => {}) })),
        ...overrides,
    };
}

function createMockCommand(overrides?: Partial<CloudflareSdkCommand>): CloudflareSdkCommand {
    return {
        name: 'bg-lint',
        command: 'bun run lint',
        open: mock(() => Promise.resolve('cmd-1')),
        restart: mock(() => Promise.resolve()),
        kill: mock(() => Promise.resolve()),
        onOutput: mock(() => ({ dispose: mock(() => {}) })),
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// CloudflareTerminal
// ---------------------------------------------------------------------------

describe('CloudflareTerminal', () => {
    it('exposes id and name from the underlying SDK terminal', () => {
        const sdk = createMockTerminal({ id: 'abc', name: 'my-shell' });
        const terminal = new CloudflareTerminal(sdk);

        expect(terminal.id).toBe('abc');
        expect(terminal.name).toBe('my-shell');
    });

    it('open() delegates to SDK terminal', async () => {
        const sdk = createMockTerminal();
        const terminal = new CloudflareTerminal(sdk);
        const dims = { cols: 120, rows: 40 };

        const id = await terminal.open(dims);

        expect(id).toBe('term-1');
        expect(sdk.open).toHaveBeenCalledWith(dims);
    });

    it('write() delegates to SDK terminal', async () => {
        const sdk = createMockTerminal();
        const terminal = new CloudflareTerminal(sdk);

        await terminal.write('ls -la');

        expect(sdk.write).toHaveBeenCalledWith('ls -la', undefined);
    });

    it('run() delegates to SDK terminal', async () => {
        const sdk = createMockTerminal();
        const terminal = new CloudflareTerminal(sdk);

        await terminal.run('echo hello');

        expect(sdk.run).toHaveBeenCalledWith('echo hello', undefined);
    });

    it('kill() delegates to SDK terminal', async () => {
        const sdk = createMockTerminal();
        const terminal = new CloudflareTerminal(sdk);

        await terminal.kill();

        expect(sdk.kill).toHaveBeenCalled();
    });

    it('onOutput() subscribes and returns an unsubscribe function', () => {
        const disposeFn = mock(() => {});
        const sdk = createMockTerminal({
            onOutput: mock(() => ({ dispose: disposeFn })),
        });
        const terminal = new CloudflareTerminal(sdk);
        const callback = mock(() => {});

        const unsubscribe = terminal.onOutput(callback);

        expect(sdk.onOutput).toHaveBeenCalledWith(callback);
        expect(typeof unsubscribe).toBe('function');

        // Calling unsubscribe should trigger dispose
        unsubscribe();
        expect(disposeFn).toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// CloudflareTask
// ---------------------------------------------------------------------------

describe('CloudflareTask', () => {
    it('exposes id, name, and command from the underlying SDK task', () => {
        const sdk = createMockTask({ id: 't-1', name: 'build', command: 'bun run build' });
        const task = new CloudflareTask(sdk);

        expect(task.id).toBe('t-1');
        expect(task.name).toBe('build');
        expect(task.command).toBe('bun run build');
    });

    it('open() delegates to SDK task', async () => {
        const sdk = createMockTask();
        const task = new CloudflareTask(sdk);

        const id = await task.open();

        expect(id).toBe('task-dev');
        expect(sdk.open).toHaveBeenCalled();
    });

    it('run() delegates to SDK task', async () => {
        const sdk = createMockTask();
        const task = new CloudflareTask(sdk);

        await task.run();

        expect(sdk.run).toHaveBeenCalled();
    });

    it('stop() delegates to SDK task', async () => {
        const sdk = createMockTask();
        const task = new CloudflareTask(sdk);

        await task.stop();

        expect(sdk.stop).toHaveBeenCalled();
    });

    it('restart() delegates to SDK task', async () => {
        const sdk = createMockTask();
        const task = new CloudflareTask(sdk);

        await task.restart();

        expect(sdk.restart).toHaveBeenCalled();
    });

    it('onOutput() subscribes and returns an unsubscribe function', () => {
        const disposeFn = mock(() => {});
        const sdk = createMockTask({
            onOutput: mock(() => ({ dispose: disposeFn })),
        });
        const task = new CloudflareTask(sdk);
        const callback = mock(() => {});

        const unsubscribe = task.onOutput(callback);

        expect(sdk.onOutput).toHaveBeenCalledWith(callback);

        unsubscribe();
        expect(disposeFn).toHaveBeenCalled();
    });
});

// ---------------------------------------------------------------------------
// CloudflareBackgroundCommand
// ---------------------------------------------------------------------------

describe('CloudflareBackgroundCommand', () => {
    it('exposes name and command from the underlying SDK command', () => {
        const sdk = createMockCommand({ name: 'watcher', command: 'bun run watch' });
        const cmd = new CloudflareBackgroundCommand(sdk);

        expect(cmd.name).toBe('watcher');
        expect(cmd.command).toBe('bun run watch');
    });

    it('name can be undefined', () => {
        const sdk = createMockCommand({ name: undefined });
        const cmd = new CloudflareBackgroundCommand(sdk);

        expect(cmd.name).toBeUndefined();
    });

    it('open() delegates to SDK command', async () => {
        const sdk = createMockCommand();
        const cmd = new CloudflareBackgroundCommand(sdk);

        const id = await cmd.open();

        expect(id).toBe('cmd-1');
        expect(sdk.open).toHaveBeenCalled();
    });

    it('kill() delegates to SDK command', async () => {
        const sdk = createMockCommand();
        const cmd = new CloudflareBackgroundCommand(sdk);

        await cmd.kill();

        expect(sdk.kill).toHaveBeenCalled();
    });

    it('restart() delegates to SDK command', async () => {
        const sdk = createMockCommand();
        const cmd = new CloudflareBackgroundCommand(sdk);

        await cmd.restart();

        expect(sdk.restart).toHaveBeenCalled();
    });

    it('onOutput() subscribes and returns an unsubscribe function', () => {
        const disposeFn = mock(() => {});
        const sdk = createMockCommand({
            onOutput: mock(() => ({ dispose: disposeFn })),
        });
        const cmd = new CloudflareBackgroundCommand(sdk);
        const callback = mock(() => {});

        const unsubscribe = cmd.onOutput(callback);

        expect(sdk.onOutput).toHaveBeenCalledWith(callback);

        unsubscribe();
        expect(disposeFn).toHaveBeenCalled();
    });
});
