import { describe, expect, it, mock } from 'bun:test';
import { SnackLogTerminal, SnackLogTask, SnackBackgroundCommand } from '../terminal';

/** Minimal SnackLike mock */
function createMockSnack() {
    const logListeners: Array<(log: { message: string }) => void> = [];
    const errorListeners: Array<(error: { message: string }) => void> = [];
    const reloadConnectedClients = mock(() => {});

    return {
        snack: {
            addLogListener(cb: (log: { message: string }) => void) {
                logListeners.push(cb);
                return {
                    remove() {
                        const idx = logListeners.indexOf(cb);
                        if (idx >= 0) logListeners.splice(idx, 1);
                    },
                };
            },
            addErrorListener(cb: (error: { message: string }) => void) {
                errorListeners.push(cb);
                return {
                    remove() {
                        const idx = errorListeners.indexOf(cb);
                        if (idx >= 0) errorListeners.splice(idx, 1);
                    },
                };
            },
            reloadConnectedClients,
        },
        emitLog(message: string) {
            for (const cb of logListeners) cb({ message });
        },
        emitError(message: string) {
            for (const cb of errorListeners) cb({ message });
        },
        logListeners,
        errorListeners,
        reloadConnectedClients,
    };
}

// ---------------------------------------------------------------------------
// SnackLogTerminal
// ---------------------------------------------------------------------------
describe('SnackLogTerminal', () => {
    it('has a unique id and a name', () => {
        const { snack } = createMockSnack();
        const terminal = new SnackLogTerminal(snack);
        expect(terminal.id).toMatch(/^snack-terminal-/);
        expect(terminal.name).toBe('Snack Console');
    });

    it('open() returns connection message', async () => {
        const { snack } = createMockSnack();
        const terminal = new SnackLogTerminal(snack);
        const result = await terminal.open();
        expect(result).toBe('Snack console connected');
    });

    it('write() is a no-op and resolves', async () => {
        const { snack } = createMockSnack();
        const terminal = new SnackLogTerminal(snack);
        await expect(terminal.write('anything')).resolves.toBeUndefined();
    });

    it('run() resolves without error', async () => {
        const { snack } = createMockSnack();
        const terminal = new SnackLogTerminal(snack);
        await expect(terminal.run('ls -la')).resolves.toBeUndefined();
    });

    it('onOutput() forwards log messages and returns unsubscribe', () => {
        const mockEnv = createMockSnack();
        const terminal = new SnackLogTerminal(mockEnv.snack);
        const received: string[] = [];
        const unsubscribe = terminal.onOutput((data) => received.push(data));

        mockEnv.emitLog('hello');
        mockEnv.emitLog('world');

        expect(received).toEqual(['hello', 'world']);

        unsubscribe();

        mockEnv.emitLog('ignored');
        expect(received).toEqual(['hello', 'world']);
    });

    it('kill() removes the log listener', async () => {
        const mockEnv = createMockSnack();
        const terminal = new SnackLogTerminal(mockEnv.snack);
        const received: string[] = [];
        terminal.onOutput((data) => received.push(data));

        mockEnv.emitLog('before kill');
        await terminal.kill();
        mockEnv.emitLog('after kill');

        expect(received).toEqual(['before kill']);
    });

    it('kill() is safe to call multiple times', async () => {
        const { snack } = createMockSnack();
        const terminal = new SnackLogTerminal(snack);
        terminal.onOutput(() => {});
        await terminal.kill();
        await expect(terminal.kill()).resolves.toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// SnackLogTask
// ---------------------------------------------------------------------------
describe('SnackLogTask', () => {
    it('has id, name, and command', () => {
        const { snack } = createMockSnack();
        const task = new SnackLogTask(snack);
        expect(task.id).toMatch(/^snack-task-/);
        expect(task.name).toBe('Snack Preview');
        expect(task.command).toBe('snack://preview');
    });

    it('open() returns the current log buffer', async () => {
        const mockEnv = createMockSnack();
        const task = new SnackLogTask(mockEnv.snack);

        // Before any logs the buffer is empty
        expect(await task.open()).toBe('');

        // Subscribe and emit some logs
        task.onOutput(() => {});
        mockEnv.emitLog('line 1');
        mockEnv.emitLog('line 2');

        expect(await task.open()).toBe('line 1\nline 2');
    });

    it('run() calls reloadConnectedClients', async () => {
        const mockEnv = createMockSnack();
        const task = new SnackLogTask(mockEnv.snack);
        await task.run();
        expect(mockEnv.reloadConnectedClients).toHaveBeenCalledTimes(1);
    });

    it('restart() calls reloadConnectedClients', async () => {
        const mockEnv = createMockSnack();
        const task = new SnackLogTask(mockEnv.snack);
        await task.restart();
        expect(mockEnv.reloadConnectedClients).toHaveBeenCalledTimes(1);
    });

    it('stop() is a no-op', async () => {
        const { snack } = createMockSnack();
        const task = new SnackLogTask(snack);
        await expect(task.stop()).resolves.toBeUndefined();
    });

    it('onOutput() forwards both log and error messages', () => {
        const mockEnv = createMockSnack();
        const task = new SnackLogTask(mockEnv.snack);
        const received: string[] = [];
        task.onOutput((data) => received.push(data));

        mockEnv.emitLog('info msg');
        mockEnv.emitError('something broke');

        expect(received).toEqual(['info msg', '[error] something broke']);
    });

    it('onOutput() unsubscribe removes both listeners', () => {
        const mockEnv = createMockSnack();
        const task = new SnackLogTask(mockEnv.snack);
        const received: string[] = [];
        const unsubscribe = task.onOutput((data) => received.push(data));

        mockEnv.emitLog('before');
        unsubscribe();
        mockEnv.emitLog('after');
        mockEnv.emitError('after-error');

        expect(received).toEqual(['before']);
    });

    it('run() is safe when reloadConnectedClients is unavailable', async () => {
        const mockEnv = createMockSnack();
        // Remove the optional method
        const snackWithoutReload = {
            addLogListener: mockEnv.snack.addLogListener,
            addErrorListener: mockEnv.snack.addErrorListener,
        };
        const task = new SnackLogTask(snackWithoutReload);
        await expect(task.run()).resolves.toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// SnackBackgroundCommand
// ---------------------------------------------------------------------------
describe('SnackBackgroundCommand', () => {
    it('has name and command', () => {
        const cmd = new SnackBackgroundCommand();
        expect(cmd.name).toBe('Snack Background');
        expect(cmd.command).toBe('snack://noop');
    });

    it('open() returns shell-unavailable message', async () => {
        const cmd = new SnackBackgroundCommand();
        const result = await cmd.open();
        expect(result).toBe('[Snack] Shell not available. Console output shown below.');
    });

    it('restart() is a no-op', async () => {
        const cmd = new SnackBackgroundCommand();
        await expect(cmd.restart()).resolves.toBeUndefined();
    });

    it('kill() is a no-op', async () => {
        const cmd = new SnackBackgroundCommand();
        await expect(cmd.kill()).resolves.toBeUndefined();
    });

    it('onOutput() returns an unsubscribe function', () => {
        const cmd = new SnackBackgroundCommand();
        const unsubscribe = cmd.onOutput(() => {});
        expect(typeof unsubscribe).toBe('function');
        // Should not throw
        unsubscribe();
    });
});
