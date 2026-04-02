/**
 * E2E-style tests for Cloudflare provider terminal, task, and background command wrappers.
 *
 * Exercises the CloudflareTerminal / CloudflareTask / CloudflareBackgroundCommand
 * classes with stateful mocks that track output and lifecycle events.
 *
 * Run with: bun test apps/web/client/e2e/provider/cf-terminal.spec.ts
 */
import { describe, expect, it, mock } from 'bun:test';
import {
    CloudflareBackgroundCommand,
    CloudflareTask,
    CloudflareTerminal,
    type CloudflareSdkCommand,
    type CloudflareSdkTask,
    type CloudflareSdkTerminal,
} from '../../../../../packages/code-provider/src/providers/cloudflare/utils/terminal';

// ---------------------------------------------------------------------------
// Stateful mock factories
// ---------------------------------------------------------------------------

/**
 * Creates a mock SDK terminal that records output history and supports
 * multiple output listeners, simulating a real terminal session.
 */
function createStatefulMockTerminal(): CloudflareSdkTerminal & {
    _outputHistory: string[];
    _emit: (data: string) => void;
} {
    const listeners: Array<(data: string) => void> = [];
    const outputHistory: string[] = [];

    const terminal: CloudflareSdkTerminal & {
        _outputHistory: string[];
        _emit: (data: string) => void;
    } = {
        id: 'term-e2e',
        name: 'e2e-shell',
        _outputHistory: outputHistory,

        _emit(data: string) {
            outputHistory.push(data);
            for (const listener of listeners) {
                listener(data);
            }
        },

        open: mock(async () => 'term-e2e'),

        write: mock(async function (this: typeof terminal, data: string) {
            // Simulate echoing the written data as output
            terminal._emit(`$ ${data}`);
        }),

        run: mock(async function (this: typeof terminal, command: string) {
            terminal._emit(`[run] ${command}`);
        }),

        kill: mock(async () => {}),

        onOutput(callback: (data: string) => void) {
            listeners.push(callback);
            return {
                dispose() {
                    const idx = listeners.indexOf(callback);
                    if (idx >= 0) listeners.splice(idx, 1);
                },
            };
        },
    };

    return terminal;
}

/**
 * Creates a mock SDK task that simulates running a command with output.
 */
function createStatefulMockTask(): CloudflareSdkTask & {
    _emit: (data: string) => void;
    _stopped: boolean;
} {
    const listeners: Array<(data: string) => void> = [];
    let stopped = false;

    const task: CloudflareSdkTask & {
        _emit: (data: string) => void;
        _stopped: boolean;
    } = {
        id: 'task-e2e',
        name: 'dev-server',
        command: 'bun run dev',
        _stopped: false,

        _emit(data: string) {
            for (const listener of listeners) {
                listener(data);
            }
        },

        open: mock(async () => 'task-e2e'),

        run: mock(async function (this: typeof task) {
            stopped = false;
            task._stopped = false;
            task._emit('[task] started');
        }),

        restart: mock(async function (this: typeof task) {
            stopped = false;
            task._stopped = false;
            task._emit('[task] restarted');
        }),

        stop: mock(async function (this: typeof task) {
            stopped = true;
            task._stopped = true;
            task._emit('[task] stopped');
        }),

        onOutput(callback: (data: string) => void) {
            listeners.push(callback);
            return {
                dispose() {
                    const idx = listeners.indexOf(callback);
                    if (idx >= 0) listeners.splice(idx, 1);
                },
            };
        },
    };

    return task;
}

/**
 * Creates a mock SDK background command.
 */
function createStatefulMockCommand(): CloudflareSdkCommand & {
    _emit: (data: string) => void;
} {
    const listeners: Array<(data: string) => void> = [];

    const cmd: CloudflareSdkCommand & {
        _emit: (data: string) => void;
    } = {
        name: 'watcher',
        command: 'bun run watch',

        _emit(data: string) {
            for (const listener of listeners) {
                listener(data);
            }
        },

        open: mock(async () => 'cmd-e2e'),

        restart: mock(async function (this: typeof cmd) {
            cmd._emit('[cmd] restarted');
        }),

        kill: mock(async () => {}),

        onOutput(callback: (data: string) => void) {
            listeners.push(callback);
            return {
                dispose() {
                    const idx = listeners.indexOf(callback);
                    if (idx >= 0) listeners.splice(idx, 1);
                },
            };
        },
    };

    return cmd;
}

// ---------------------------------------------------------------------------
// CloudflareTerminal
// ---------------------------------------------------------------------------

describe('CF Provider Terminal (E2E)', () => {
    it('opens a terminal and receives output from write', async () => {
        const sdk = createStatefulMockTerminal();
        const terminal = new CloudflareTerminal(sdk);

        const received: string[] = [];
        terminal.onOutput((data: string) => {
            received.push(data);
        });

        await terminal.open({ cols: 80, rows: 24 });
        await terminal.write('echo hello');

        expect(received).toEqual(['$ echo hello']);
    });

    it('receives output from run command', async () => {
        const sdk = createStatefulMockTerminal();
        const terminal = new CloudflareTerminal(sdk);

        const received: string[] = [];
        terminal.onOutput((data: string) => {
            received.push(data);
        });

        await terminal.run('npm install');

        expect(received).toEqual(['[run] npm install']);
    });

    it('supports multiple listeners', async () => {
        const sdk = createStatefulMockTerminal();
        const terminal = new CloudflareTerminal(sdk);

        const log1: string[] = [];
        const log2: string[] = [];

        terminal.onOutput((data) => log1.push(data));
        terminal.onOutput((data) => log2.push(data));

        await terminal.write('test');

        expect(log1).toEqual(['$ test']);
        expect(log2).toEqual(['$ test']);
    });

    it('unsubscribe stops delivering output to that listener', async () => {
        const sdk = createStatefulMockTerminal();
        const terminal = new CloudflareTerminal(sdk);

        const received: string[] = [];
        const unsubscribe = terminal.onOutput((data) => received.push(data));

        await terminal.write('before');
        unsubscribe();
        await terminal.write('after');

        expect(received).toEqual(['$ before']);
    });

    it('kill delegates to the underlying SDK terminal', async () => {
        const sdk = createStatefulMockTerminal();
        const terminal = new CloudflareTerminal(sdk);

        await terminal.kill();

        expect(sdk.kill).toHaveBeenCalled();
    });

    it('exposes id and name from the SDK terminal', () => {
        const sdk = createStatefulMockTerminal();
        const terminal = new CloudflareTerminal(sdk);

        expect(terminal.id).toBe('term-e2e');
        expect(terminal.name).toBe('e2e-shell');
    });
});

// ---------------------------------------------------------------------------
// CloudflareTask
// ---------------------------------------------------------------------------

describe('CF Provider Task (E2E)', () => {
    it('runs a task and receives output', async () => {
        const sdk = createStatefulMockTask();
        const task = new CloudflareTask(sdk);

        const received: string[] = [];
        task.onOutput((data) => received.push(data));

        await task.open();
        await task.run();

        expect(received).toEqual(['[task] started']);
    });

    it('stop and restart lifecycle', async () => {
        const sdk = createStatefulMockTask();
        const task = new CloudflareTask(sdk);

        const received: string[] = [];
        task.onOutput((data) => received.push(data));

        await task.run();
        await task.stop();
        await task.restart();

        expect(received).toEqual(['[task] started', '[task] stopped', '[task] restarted']);
    });

    it('exposes id, name, and command', () => {
        const sdk = createStatefulMockTask();
        const task = new CloudflareTask(sdk);

        expect(task.id).toBe('task-e2e');
        expect(task.name).toBe('dev-server');
        expect(task.command).toBe('bun run dev');
    });

    it('unsubscribe from task output', async () => {
        const sdk = createStatefulMockTask();
        const task = new CloudflareTask(sdk);

        const received: string[] = [];
        const unsubscribe = task.onOutput((data) => received.push(data));

        await task.run();
        unsubscribe();
        await task.restart();

        expect(received).toEqual(['[task] started']);
    });
});

// ---------------------------------------------------------------------------
// CloudflareBackgroundCommand
// ---------------------------------------------------------------------------

describe('CF Provider BackgroundCommand (E2E)', () => {
    it('opens and receives output on restart', async () => {
        const sdk = createStatefulMockCommand();
        const cmd = new CloudflareBackgroundCommand(sdk);

        const received: string[] = [];
        cmd.onOutput((data) => received.push(data));

        await cmd.open();
        await cmd.restart();

        expect(received).toEqual(['[cmd] restarted']);
    });

    it('exposes name and command', () => {
        const sdk = createStatefulMockCommand();
        const cmd = new CloudflareBackgroundCommand(sdk);

        expect(cmd.name).toBe('watcher');
        expect(cmd.command).toBe('bun run watch');
    });

    it('kill delegates to the underlying SDK command', async () => {
        const sdk = createStatefulMockCommand();
        const cmd = new CloudflareBackgroundCommand(sdk);

        await cmd.kill();

        expect(sdk.kill).toHaveBeenCalled();
    });

    it('unsubscribe from background command output', async () => {
        const sdk = createStatefulMockCommand();
        const cmd = new CloudflareBackgroundCommand(sdk);

        const received: string[] = [];
        const unsubscribe = cmd.onOutput((data) => received.push(data));

        await cmd.restart();
        unsubscribe();
        await cmd.restart();

        expect(received).toEqual(['[cmd] restarted']);
    });
});
