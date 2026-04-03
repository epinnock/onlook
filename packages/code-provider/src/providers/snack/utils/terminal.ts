import {
    ProviderTerminal,
    ProviderTask,
    ProviderBackgroundCommand,
    type ProviderTerminalShellSize,
} from '../../../types';

// Inline interfaces to avoid bundling issues with snack-sdk
interface SnackLogListener {
    remove(): void;
}
interface SnackLike {
    addLogListener(cb: (log: { message: string }) => void): SnackLogListener;
    addErrorListener(cb: (error: { message: string }) => void): SnackLogListener;
    reloadConnectedClients?(): void;
}

let terminalCounter = 0;

/**
 * SnackLogTerminal streams device console output via Snack's log listener.
 * Snack has no shell, so write() is a no-op and run() returns a notice.
 */
export class SnackLogTerminal extends ProviderTerminal {
    private readonly _id: string;
    private readonly _name: string;
    private _listener: SnackLogListener | null = null;

    constructor(private readonly snack: SnackLike) {
        super();
        this._id = `snack-terminal-${++terminalCounter}`;
        this._name = 'Snack Console';
    }

    get id(): string {
        return this._id;
    }

    get name(): string {
        return this._name;
    }

    async open(_dimensions?: ProviderTerminalShellSize): Promise<string> {
        return 'Snack console connected';
    }

    async write(_input: string, _dimensions?: ProviderTerminalShellSize): Promise<void> {
        // No-op: cannot write to a device console
    }

    async run(_input: string, _dimensions?: ProviderTerminalShellSize): Promise<void> {
        // Snack has no shell — inform the caller
        return void 0;
    }

    async kill(): Promise<void> {
        if (this._listener) {
            this._listener.remove();
            this._listener = null;
        }
    }

    onOutput(callback: (data: string) => void): () => void {
        this._listener = this.snack.addLogListener((log) => {
            callback(log.message);
        });
        return () => {
            if (this._listener) {
                this._listener.remove();
                this._listener = null;
            }
        };
    }
}

/**
 * SnackLogTask surfaces device logs as task output.
 * run()/restart() reload connected clients when the SDK supports it.
 */
export class SnackLogTask extends ProviderTask {
    private readonly _id: string;
    private readonly _name: string;
    private readonly _command: string;
    private readonly logBuffer: string[] = [];
    private _logListener: SnackLogListener | null = null;
    private _errorListener: SnackLogListener | null = null;

    constructor(private readonly snack: SnackLike) {
        super();
        this._id = `snack-task-${++terminalCounter}`;
        this._name = 'Snack Preview';
        this._command = 'snack://preview';
    }

    get id(): string {
        return this._id;
    }

    get name(): string {
        return this._name;
    }

    get command(): string {
        return this._command;
    }

    async open(_dimensions?: ProviderTerminalShellSize): Promise<string> {
        return this.logBuffer.join('\n');
    }

    async run(): Promise<void> {
        this.snack.reloadConnectedClients?.();
    }

    async restart(): Promise<void> {
        this.snack.reloadConnectedClients?.();
    }

    async stop(): Promise<void> {
        // No-op: the device preview lifecycle is managed by Snack
    }

    onOutput(callback: (data: string) => void): () => void {
        this._logListener = this.snack.addLogListener((log) => {
            this.logBuffer.push(log.message);
            callback(log.message);
        });
        this._errorListener = this.snack.addErrorListener((error) => {
            const msg = `[error] ${error.message}`;
            this.logBuffer.push(msg);
            callback(msg);
        });
        return () => {
            if (this._logListener) {
                this._logListener.remove();
                this._logListener = null;
            }
            if (this._errorListener) {
                this._errorListener.remove();
                this._errorListener = null;
            }
        };
    }
}

/**
 * Minimal stub — Snack does not support background shell commands.
 */
export class SnackBackgroundCommand extends ProviderBackgroundCommand {
    private readonly _name: string | undefined;
    private readonly _command: string;

    constructor() {
        super();
        this._name = 'Snack Background';
        this._command = 'snack://noop';
    }

    get name(): string | undefined {
        return this._name;
    }

    get command(): string {
        return this._command;
    }

    async open(): Promise<string> {
        return '[Snack] Shell not available. Console output shown below.';
    }

    async restart(): Promise<void> {
        // No-op
    }

    async kill(): Promise<void> {
        // No-op
    }

    onOutput(_callback: (data: string) => void): () => void {
        // No output to subscribe to for background commands
        return () => {};
    }
}
