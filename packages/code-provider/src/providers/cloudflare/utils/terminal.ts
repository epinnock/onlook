import {
    ProviderBackgroundCommand,
    ProviderTask,
    ProviderTerminal,
    type ProviderTerminalShellSize,
} from '../../../types';

// ---------------------------------------------------------------------------
// Inline interface stubs for the Cloudflare Sandbox SDK (not yet installed).
// These will be replaced by real SDK types once @cloudflare/sandbox is added.
// ---------------------------------------------------------------------------

interface CloudflareSandboxDisposable {
    dispose(): void;
}

/** Mirrors the terminal handle returned by the Cloudflare Sandbox SDK. */
export interface CloudflareSdkTerminal {
    id: string;
    name: string;
    open(dimensions?: ProviderTerminalShellSize): Promise<string>;
    write(data: string, dimensions?: ProviderTerminalShellSize): Promise<void>;
    run(command: string, dimensions?: ProviderTerminalShellSize): Promise<void>;
    kill(): Promise<void>;
    onOutput(callback: (data: string) => void): CloudflareSandboxDisposable;
}

/** Mirrors the task handle returned by the Cloudflare Sandbox SDK. */
export interface CloudflareSdkTask {
    id: string;
    name: string;
    command: string;
    open(dimensions?: ProviderTerminalShellSize): Promise<string>;
    run(): Promise<void>;
    restart(): Promise<void>;
    stop(): Promise<void>;
    onOutput(callback: (data: string) => void): CloudflareSandboxDisposable;
}

/** Mirrors the background command handle returned by the Cloudflare Sandbox SDK. */
export interface CloudflareSdkCommand {
    name?: string;
    command: string;
    open(): Promise<string>;
    restart(): Promise<void>;
    kill(): Promise<void>;
    onOutput(callback: (data: string) => void): CloudflareSandboxDisposable;
}

// ---------------------------------------------------------------------------
// CloudflareTerminal
// ---------------------------------------------------------------------------

export class CloudflareTerminal extends ProviderTerminal {
    constructor(private readonly _terminal: CloudflareSdkTerminal) {
        super();
    }

    get id(): string {
        return this._terminal.id;
    }

    get name(): string {
        return this._terminal.name;
    }

    open(dimensions?: ProviderTerminalShellSize): Promise<string> {
        return this._terminal.open(dimensions);
    }

    write(input: string, dimensions?: ProviderTerminalShellSize): Promise<void> {
        return this._terminal.write(input, dimensions);
    }

    run(input: string, dimensions?: ProviderTerminalShellSize): Promise<void> {
        return this._terminal.run(input, dimensions);
    }

    kill(): Promise<void> {
        return this._terminal.kill();
    }

    onOutput(callback: (data: string) => void): () => void {
        const disposable = this._terminal.onOutput(callback);
        return () => {
            disposable.dispose();
        };
    }
}

// ---------------------------------------------------------------------------
// CloudflareTask
// ---------------------------------------------------------------------------

export class CloudflareTask extends ProviderTask {
    constructor(private readonly _task: CloudflareSdkTask) {
        super();
    }

    get id(): string {
        return this._task.id;
    }

    get name(): string {
        return this._task.name;
    }

    get command(): string {
        return this._task.command;
    }

    open(dimensions?: ProviderTerminalShellSize): Promise<string> {
        return this._task.open(dimensions);
    }

    run(): Promise<void> {
        return this._task.run();
    }

    restart(): Promise<void> {
        return this._task.restart();
    }

    stop(): Promise<void> {
        return this._task.stop();
    }

    onOutput(callback: (data: string) => void): () => void {
        const disposable = this._task.onOutput(callback);
        return () => {
            disposable.dispose();
        };
    }
}

// ---------------------------------------------------------------------------
// CloudflareBackgroundCommand
// ---------------------------------------------------------------------------

export class CloudflareBackgroundCommand extends ProviderBackgroundCommand {
    constructor(private readonly _command: CloudflareSdkCommand) {
        super();
    }

    get name(): string | undefined {
        return this._command.name;
    }

    get command(): string {
        return this._command.command;
    }

    open(): Promise<string> {
        return this._command.open();
    }

    restart(): Promise<void> {
        return this._command.restart();
    }

    kill(): Promise<void> {
        return this._command.kill();
    }

    onOutput(callback: (data: string) => void): () => void {
        const disposable = this._command.onOutput(callback);
        return () => {
            disposable.dispose();
        };
    }
}
