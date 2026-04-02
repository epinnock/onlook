/**
 * Cloudflare Sandbox provider implementation.
 *
 * The Cloudflare sandbox SDK (`@cloudflare/sandbox`) exposes a `Sandbox` Durable
 * Object and a companion `SandboxClient` HTTP client.  In production the
 * consumer accesses the sandbox through an RPC stub obtained via `getSandbox()`.
 * For simplicity the provider stores this reference as `ISandbox` (the public
 * interface) so it can be supplied by either the DO stub or a test double.
 *
 * Where the real SDK API differs from the interfaces assumed by the Phase-1
 * utility files (which define their own lightweight contracts such as
 * `SandboxFilesAPI`), this provider bridges the gap by calling the SDK methods
 * directly rather than routing through the utility helpers.
 */

import type {
    ISandbox,
    ExecResult,
    FileWatchSSEEvent,
} from '@cloudflare/sandbox';
import {
    parseSSEStream,
} from '@cloudflare/sandbox';
import {
    Provider,
    ProviderFileWatcher,
    type CopyFileOutput,
    type CopyFilesInput,
    type CreateDirectoryInput,
    type CreateDirectoryOutput,
    type CreateProjectInput,
    type CreateProjectOutput,
    type CreateSessionInput,
    type CreateSessionOutput,
    type CreateTerminalInput,
    type CreateTerminalOutput,
    type DeleteFilesInput,
    type DeleteFilesOutput,
    type DownloadFilesInput,
    type DownloadFilesOutput,
    type GetTaskInput,
    type GetTaskOutput,
    type GitStatusInput,
    type GitStatusOutput,
    type InitializeInput,
    type InitializeOutput,
    type ListFilesInput,
    type ListFilesOutput,
    type ListProjectsInput,
    type ListProjectsOutput,
    type PauseProjectInput,
    type PauseProjectOutput,
    type ReadFileInput,
    type ReadFileOutput,
    type RenameFileInput,
    type RenameFileOutput,
    type SetupInput,
    type SetupOutput,
    type StatFileInput,
    type StatFileOutput,
    type StopProjectInput,
    type StopProjectOutput,
    type TerminalBackgroundCommandInput,
    type TerminalBackgroundCommandOutput,
    type TerminalCommandInput,
    type TerminalCommandOutput,
    type WatchEvent,
    type WatchFilesInput,
    type WatchFilesOutput,
    type WriteFileInput,
    type WriteFileOutput,
} from '../../types';
import type { CloudflareProviderOptions } from './types';
import { CloudflareTerminal, CloudflareTask, CloudflareBackgroundCommand } from './utils/terminal';
import type { CloudflareSdkTerminal, CloudflareSdkTask, CloudflareSdkCommand } from './utils/terminal';

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class CloudflareSandboxProvider extends Provider {
    /**
     * The sandbox stub obtained via `getSandbox()` or injected directly.
     * Typed as `ISandbox` which is the public interface of the Durable Object.
     *
     * Set during `initialize()`.
     */
    private sandbox: ISandbox | null = null;

    constructor(public readonly options: CloudflareProviderOptions) {
        super();
    }

    // -- lifecycle -----------------------------------------------------------

    async initialize(_input: InitializeInput): Promise<InitializeOutput> {
        if (!this.options.sandboxId) {
            return {};
        }

        // The sandbox stub is expected to be provided externally via options.
        // In production, the caller obtains the stub using getSandbox() from
        // a Cloudflare Worker and passes it into the provider options.
        //
        // If an `_sandboxStub` escape hatch is present on options, use it:
        const stub = (this.options as CloudflareProviderOptionsInternal)._sandboxStub;
        if (stub) {
            this.sandbox = stub;
        }

        return {};
    }

    async setup(_input: SetupInput): Promise<SetupOutput> {
        // No-op: the Cloudflare sandbox is ready once created.
        return {};
    }

    async reload(): Promise<boolean> {
        // Best-effort: restart the dev task by re-executing the start command.
        // The Cloudflare SDK does not have a first-class "task" concept so we
        // return false to indicate no reload action was taken.
        return false;
    }

    async reconnect(): Promise<void> {
        // The Cloudflare sandbox uses HTTP transport which is inherently
        // reconnectable; no explicit reconnect step is needed.
    }

    async ping(): Promise<boolean> {
        if (!this.sandbox) {
            return false;
        }
        try {
            const result = await this.sandbox.exec('echo "ping"');
            return result.success;
        } catch {
            return false;
        }
    }

    async destroy(): Promise<void> {
        this.sandbox = null;
    }

    // -- project management --------------------------------------------------

    static async createProject(_input: CreateProjectInput): Promise<CreateProjectOutput> {
        // Cloudflare sandboxes are created through the Durable Object
        // infrastructure (getSandbox). A standalone "create project" flow would
        // involve creating the DO via the Worker binding, which requires env
        // context unavailable in a static method.  Return a placeholder.
        throw new Error(
            'CloudflareSandboxProvider.createProject is not yet implemented. ' +
            'Create sandboxes via your Cloudflare Worker using getSandbox().',
        );
    }

    static async createProjectFromGit(_input: {
        repoUrl: string;
        branch: string;
    }): Promise<CreateProjectOutput> {
        throw new Error(
            'CloudflareSandboxProvider.createProjectFromGit is not yet implemented. ' +
            'Clone repositories inside an existing sandbox via sandbox.gitCheckout().',
        );
    }

    async pauseProject(_input: PauseProjectInput): Promise<PauseProjectOutput> {
        // Cloudflare containers auto-sleep after the configured sleepAfter
        // duration.  There is no explicit "pause" RPC.
        return {};
    }

    async stopProject(_input: StopProjectInput): Promise<StopProjectOutput> {
        if (this.sandbox) {
            // Destroying the sandbox stops the container.
            await this.sandbox.exec('exit 0').catch(() => {});
        }
        return {};
    }

    async listProjects(_input: ListProjectsInput): Promise<ListProjectsOutput> {
        // The Cloudflare sandbox SDK does not expose a project listing endpoint;
        // project management is handled at the Worker / DO namespace level.
        return {};
    }

    // -- session -------------------------------------------------------------

    async createSession(input: CreateSessionInput): Promise<CreateSessionOutput> {
        if (!this.sandbox) {
            throw new Error('Sandbox not initialized');
        }
        await this.sandbox.createSession({ id: input.args.id });
        return {};
    }

    // -- file operations -----------------------------------------------------

    async writeFile(input: WriteFileInput): Promise<WriteFileOutput> {
        if (!this.sandbox) {
            throw new Error('Sandbox not initialized');
        }
        try {
            const content =
                typeof input.args.content === 'string'
                    ? input.args.content
                    : new TextDecoder().decode(input.args.content);
            await this.sandbox.writeFile(input.args.path, content);
            return { success: true };
        } catch (error) {
            console.error(`Error writing file ${input.args.path}:`, error);
            return { success: false };
        }
    }

    async readFile(input: ReadFileInput): Promise<ReadFileOutput> {
        if (!this.sandbox) {
            throw new Error('Sandbox not initialized');
        }
        const result = await this.sandbox.readFile(input.args.path);
        if (!result.success) {
            throw new Error(`Failed to read file ${input.args.path}`);
        }
        return {
            file: {
                path: input.args.path,
                content: result.content,
                type: 'text' as const,
                toString: () => result.content,
            },
        };
    }

    async listFiles(input: ListFilesInput): Promise<ListFilesOutput> {
        if (!this.sandbox) {
            throw new Error('Sandbox not initialized');
        }
        const result = await this.sandbox.listFiles(input.args.path);
        return {
            files: result.files.map((f) => ({
                name: f.name,
                type: f.type === 'symlink' || f.type === 'other' ? 'file' as const : f.type,
                isSymlink: f.type === 'symlink',
            })),
        };
    }

    async deleteFiles(input: DeleteFilesInput): Promise<DeleteFilesOutput> {
        if (!this.sandbox) {
            throw new Error('Sandbox not initialized');
        }
        await this.sandbox.deleteFile(input.args.path);
        return {};
    }

    async renameFile(input: RenameFileInput): Promise<RenameFileOutput> {
        if (!this.sandbox) {
            throw new Error('Sandbox not initialized');
        }
        await this.sandbox.renameFile(input.args.oldPath, input.args.newPath);
        return {};
    }

    async copyFiles(input: CopyFilesInput): Promise<CopyFileOutput> {
        if (!this.sandbox) {
            throw new Error('Sandbox not initialized');
        }
        // The Cloudflare SDK does not have a native copy; use exec as fallback.
        const flags = input.args.recursive ? '-r' : '';
        const overwrite = input.args.overwrite ? '' : '-n';
        await this.sandbox.exec(
            `cp ${flags} ${overwrite} "${input.args.sourcePath}" "${input.args.targetPath}"`,
        );
        return {};
    }

    async downloadFiles(input: DownloadFilesInput): Promise<DownloadFilesOutput> {
        if (!this.sandbox) {
            throw new Error('Sandbox not initialized');
        }
        // The Cloudflare SDK does not provide a download URL.
        // Read the file content instead — callers may base64-encode it.
        const result = await this.sandbox.readFile(input.args.path);
        // Return undefined url since there is no hosted download link.
        return { url: undefined };
    }

    async createDirectory(input: CreateDirectoryInput): Promise<CreateDirectoryOutput> {
        if (!this.sandbox) {
            throw new Error('Sandbox not initialized');
        }
        await this.sandbox.mkdir(input.args.path, { recursive: true });
        return {};
    }

    async statFile(input: StatFileInput): Promise<StatFileOutput> {
        if (!this.sandbox) {
            throw new Error('Sandbox not initialized');
        }
        // The Cloudflare SDK does not have a dedicated stat method.
        // Use `exec` with `stat` to determine the type.
        const result = await this.sandbox.exec(
            `stat -c '%F' "${input.args.path}" 2>/dev/null || echo "unknown"`,
        );
        const output = result.stdout.trim().toLowerCase();
        const isDir = output.includes('directory');
        return {
            type: isDir ? 'directory' : 'file',
        };
    }

    // -- terminal / commands -------------------------------------------------

    async createTerminal(_input: CreateTerminalInput): Promise<CreateTerminalOutput> {
        if (!this.sandbox) {
            throw new Error('Sandbox not initialized');
        }
        // The Cloudflare SDK does not have a "terminal" abstraction equivalent
        // to CodeSandbox.  We create a lightweight adapter backed by exec/process.
        const terminalId = `cf-term-${Date.now()}`;
        const adapter = createTerminalAdapter(this.sandbox, terminalId);
        return {
            terminal: new CloudflareTerminal(adapter),
        };
    }

    async getTask(input: GetTaskInput): Promise<GetTaskOutput> {
        if (!this.sandbox) {
            throw new Error('Sandbox not initialized');
        }
        // The Cloudflare SDK does not have a "task" registry.
        // Wrap a process as a task-like object.
        const process = await this.sandbox.getProcess(input.args.id);
        if (!process) {
            throw new Error(`Task ${input.args.id} not found`);
        }
        const adapter = createTaskAdapter(this.sandbox, process);
        return {
            task: new CloudflareTask(adapter),
        };
    }

    async runCommand({ args }: TerminalCommandInput): Promise<TerminalCommandOutput> {
        if (!this.sandbox) {
            throw new Error('Sandbox not initialized');
        }
        const result = await this.sandbox.exec(args.command);
        return {
            output: result.stdout + (result.stderr ? `\n${result.stderr}` : ''),
        };
    }

    async runBackgroundCommand(
        input: TerminalBackgroundCommandInput,
    ): Promise<TerminalBackgroundCommandOutput> {
        if (!this.sandbox) {
            throw new Error('Sandbox not initialized');
        }
        const process = await this.sandbox.startProcess(input.args.command);
        const adapter = createBackgroundCommandAdapter(this.sandbox, process, input.args.command);
        return {
            command: new CloudflareBackgroundCommand(adapter),
        };
    }

    // -- file watching -------------------------------------------------------

    async watchFiles(input: WatchFilesInput): Promise<WatchFilesOutput> {
        if (!this.sandbox) {
            throw new Error('Sandbox not initialized');
        }
        const watcher = new CloudflareSandboxFileWatcher(this.sandbox);
        await watcher.start(input);

        if (input.onFileChange) {
            watcher.registerEventCallback(async (event) => {
                if (input.onFileChange) {
                    await input.onFileChange({ type: event.type, paths: event.paths });
                }
            });
        }

        return { watcher };
    }

    // -- git -----------------------------------------------------------------

    async gitStatus(_input: GitStatusInput): Promise<GitStatusOutput> {
        if (!this.sandbox) {
            throw new Error('Sandbox not initialized');
        }
        const result = await this.sandbox.exec(
            'git diff --name-only HEAD 2>/dev/null || true',
        );
        const changedFiles = result.stdout
            .split('\n')
            .map((l) => l.trim())
            .filter(Boolean);
        return { changedFiles };
    }
}

// ---------------------------------------------------------------------------
// CloudflareSandboxFileWatcher — bridges the SDK SSE-based watch to the
// ProviderFileWatcher interface expected by the abstract Provider.
// ---------------------------------------------------------------------------

class CloudflareSandboxFileWatcher extends ProviderFileWatcher {
    private abortController: AbortController | null = null;
    private callbacks: Array<(event: WatchEvent) => Promise<void>> = [];

    constructor(private readonly sandbox: ISandbox) {
        super();
    }

    async start(input: WatchFilesInput): Promise<void> {
        this.abortController = new AbortController();
        const stream = await this.sandbox.watch(input.args.path, {
            recursive: input.args.recursive,
            exclude: input.args.excludes,
        });

        // Process the SSE stream in the background
        void this.consumeStream(stream);
    }

    async stop(): Promise<void> {
        this.abortController?.abort();
        this.abortController = null;
    }

    registerEventCallback(callback: (event: WatchEvent) => Promise<void>): void {
        this.callbacks.push(callback);
    }

    private async consumeStream(stream: ReadableStream<Uint8Array>): Promise<void> {
        try {
            const signal = this.abortController?.signal;
            for await (const event of parseSSEStream<FileWatchSSEEvent>(stream, signal)) {
                if (event.type === 'event') {
                    const mapped = mapWatchEventType(event.eventType);
                    if (mapped) {
                        const watchEvent: WatchEvent = {
                            type: mapped,
                            paths: [event.path],
                        };
                        for (const cb of this.callbacks) {
                            cb(watchEvent).catch((err) =>
                                console.error('File watch callback error:', err),
                            );
                        }
                    }
                }
            }
        } catch (err: unknown) {
            // AbortError is expected when stop() is called.
            if (err instanceof Error && err.name !== 'AbortError') {
                console.error('File watch stream error:', err);
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Map a Cloudflare file watch event type to the Provider WatchEvent type.
 */
function mapWatchEventType(
    eventType: string,
): WatchEvent['type'] | null {
    switch (eventType) {
        case 'create':
            return 'add';
        case 'modify':
        case 'attrib':
            return 'change';
        case 'delete':
            return 'remove';
        // move_from/move_to are paired events; treat move_to as an add and
        // move_from as a remove.
        case 'move_to':
            return 'add';
        case 'move_from':
            return 'remove';
        default:
            return null;
    }
}

/**
 * Build a lightweight adapter object that conforms to CloudflareSdkTerminal,
 * allowing CloudflareTerminal to wrap it.
 *
 * Because the Cloudflare sandbox does not have a persistent terminal concept
 * (like CodeSandbox's Terminal), we back each operation with `exec` / process.
 */
function createTerminalAdapter(sandbox: ISandbox, id: string): CloudflareSdkTerminal {
    let outputListeners: Array<(data: string) => void> = [];
    let currentProcess: Awaited<ReturnType<ISandbox['startProcess']>> | null = null;

    return {
        id,
        name: `cloudflare-terminal-${id}`,

        async open() {
            return id;
        },

        async write(data: string) {
            const result = await sandbox.exec(data);
            const output = result.stdout + result.stderr;
            for (const listener of outputListeners) {
                listener(output);
            }
        },

        async run(command: string) {
            currentProcess = await sandbox.startProcess(command);
            // Stream logs if the process starts successfully.
            void (async () => {
                try {
                    const stream = await sandbox.streamProcessLogs(currentProcess!.id);
                    const reader = stream.getReader();
                    const decoder = new TextDecoder();
                    while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        const text = decoder.decode(value, { stream: true });
                        for (const listener of outputListeners) {
                            listener(text);
                        }
                    }
                } catch {
                    // Process may have already terminated.
                }
            })();
        },

        async kill() {
            if (currentProcess) {
                await sandbox.killProcess(currentProcess.id).catch(() => {});
                currentProcess = null;
            }
        },

        onOutput(callback: (data: string) => void) {
            outputListeners.push(callback);
            return {
                dispose() {
                    outputListeners = outputListeners.filter((cb) => cb !== callback);
                },
            };
        },
    };
}

/**
 * Build a lightweight adapter conforming to CloudflareSdkTask.
 */
function createTaskAdapter(
    sandbox: ISandbox,
    process: NonNullable<Awaited<ReturnType<ISandbox['getProcess']>>>,
): CloudflareSdkTask {
    let outputListeners: Array<(data: string) => void> = [];

    return {
        id: process.id,
        name: `task-${process.id}`,
        command: process.command,

        async open() {
            return process.id;
        },

        async run() {
            // The process is already running. Stream its output.
            void streamProcessOutput(sandbox, process.id, outputListeners);
        },

        async restart() {
            // Kill and re-start the same command.
            await sandbox.killProcess(process.id).catch(() => {});
            const newProcess = await sandbox.startProcess(process.command);
            // Update the reference (mutation is intentional for the adapter).
            (this as { id: string }).id = newProcess.id;
            void streamProcessOutput(sandbox, newProcess.id, outputListeners);
        },

        async stop() {
            await sandbox.killProcess(process.id).catch(() => {});
        },

        onOutput(callback: (data: string) => void) {
            outputListeners.push(callback);
            return {
                dispose() {
                    outputListeners = outputListeners.filter((cb) => cb !== callback);
                },
            };
        },
    };
}

/**
 * Build a lightweight adapter conforming to CloudflareSdkCommand.
 */
function createBackgroundCommandAdapter(
    sandbox: ISandbox,
    process: Awaited<ReturnType<ISandbox['startProcess']>>,
    command: string,
): CloudflareSdkCommand {
    let outputListeners: Array<(data: string) => void> = [];
    let currentProcessId = process.id;

    return {
        name: undefined,
        command,

        async open() {
            void streamProcessOutput(sandbox, currentProcessId, outputListeners);
            return currentProcessId;
        },

        async restart() {
            await sandbox.killProcess(currentProcessId).catch(() => {});
            const newProcess = await sandbox.startProcess(command);
            currentProcessId = newProcess.id;
            void streamProcessOutput(sandbox, currentProcessId, outputListeners);
        },

        async kill() {
            await sandbox.killProcess(currentProcessId).catch(() => {});
        },

        onOutput(callback: (data: string) => void) {
            outputListeners.push(callback);
            return {
                dispose() {
                    outputListeners = outputListeners.filter((cb) => cb !== callback);
                },
            };
        },
    };
}

/**
 * Stream a process's logs and forward text to a set of listeners.
 */
async function streamProcessOutput(
    sandbox: ISandbox,
    processId: string,
    listeners: Array<(data: string) => void>,
): Promise<void> {
    try {
        const stream = await sandbox.streamProcessLogs(processId);
        const reader = stream.getReader();
        const decoder = new TextDecoder();
        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const text = decoder.decode(value, { stream: true });
            for (const listener of listeners) {
                listener(text);
            }
        }
    } catch {
        // Process may have already terminated.
    }
}

// ---------------------------------------------------------------------------
// Internal option extension for injecting the sandbox stub.
// ---------------------------------------------------------------------------

interface CloudflareProviderOptionsInternal extends CloudflareProviderOptions {
    _sandboxStub?: ISandbox;
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { CloudflareSandboxProvider as default };
export type { CloudflareProviderOptions } from './types';
export type { CloudflareSandboxConfig, CloudflareSessionInfo } from './types';
