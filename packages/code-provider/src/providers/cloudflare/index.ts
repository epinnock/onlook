/**
 * Cloudflare Sandbox provider — HTTP-based.
 *
 * Communicates with the Cloudflare Sandbox Worker via REST endpoints.
 * The Worker handles the actual SDK interaction inside the Workers runtime.
 *
 * Worker endpoints used:
 *   POST /sandbox/create   → create sandbox
 *   POST /sandbox/exec     → execute command
 *   POST /sandbox/file/read  → read file
 *   POST /sandbox/file/write → write file
 *   POST /sandbox/file/list  → list directory
 *   POST /sandbox/file/mkdir → create directory
 */

import {
    Provider,
    ProviderFileWatcher,
    type ProviderCapabilities,
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
// HTTP helper
// ---------------------------------------------------------------------------

async function workerFetch<T>(workerUrl: string, path: string, body: Record<string, unknown>): Promise<T> {
    const res = await fetch(`${workerUrl}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const data = (await res.json()) as T & { error?: string };
    if (data.error) throw new Error(data.error);
    return data;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export class CloudflareSandboxProvider extends Provider {
    private workerUrl: string;
    private sandboxId: string;

    constructor(public readonly options: CloudflareProviderOptions) {
        super();
        this.workerUrl = options.workerUrl || 'http://localhost:8787';
        this.sandboxId = options.sandboxId || '';
    }

    private async exec(command: string): Promise<{ stdout: string; stderr: string; exitCode: number; success: boolean }> {
        return workerFetch(this.workerUrl, '/sandbox/exec', {
            sandboxId: this.sandboxId,
            command,
        });
    }

    // -- lifecycle -----------------------------------------------------------

    async initialize(_input: InitializeInput): Promise<InitializeOutput> {
        if (this.sandboxId) {
            // Verify sandbox is reachable
            try {
                await this.exec('echo "init-ok"');
            } catch (e) {
                console.warn('CF sandbox not reachable during init:', e);
            }
        }
        return {};
    }

    async setup(_input: SetupInput): Promise<SetupOutput> { return {}; }
    async reload(): Promise<boolean> { return false; }
    async reconnect(): Promise<void> {}

    async ping(): Promise<boolean> {
        try {
            const r = await this.exec('echo "ping"');
            return r.success;
        } catch { return false; }
    }

    getCapabilities(): ProviderCapabilities {
        return {
            supportsTerminal: true,
            supportsShell: true,
            supportsBackgroundCommands: true,
            // CF Sandbox does not have hibernate/resume semantics like CSB.
            supportsHibernate: false,
            supportsRemoteScreenshot: true,
        };
    }

    async destroy(): Promise<void> {
        this.sandboxId = '';
    }

    // -- project management --------------------------------------------------

    static async createProject(_input: CreateProjectInput): Promise<CreateProjectOutput> {
        throw new Error('Use cfSandbox.create tRPC route instead.');
    }

    static async createProjectFromGit(_input: { repoUrl: string; branch: string }): Promise<CreateProjectOutput> {
        throw new Error('Use cfSandbox.create tRPC route instead.');
    }

    async pauseProject(_input: PauseProjectInput): Promise<PauseProjectOutput> { return {}; }
    async stopProject(_input: StopProjectInput): Promise<StopProjectOutput> { return {}; }
    async listProjects(_input: ListProjectsInput): Promise<ListProjectsOutput> { return {}; }

    async createSession(_input: CreateSessionInput): Promise<CreateSessionOutput> { return {}; }

    // -- file operations -----------------------------------------------------

    async writeFile(input: WriteFileInput): Promise<WriteFileOutput> {
        await workerFetch(this.workerUrl, '/sandbox/file/write', {
            sandboxId: this.sandboxId,
            path: input.args.path,
            content: input.args.content,
        });
        return { success: true };
    }

    async readFile(input: ReadFileInput): Promise<ReadFileOutput> {
        const { content } = await workerFetch<{ content: string }>(this.workerUrl, '/sandbox/file/read', {
            sandboxId: this.sandboxId,
            path: input.args.path,
        });
        return {
            file: {
                type: 'text',
                path: input.args.path,
                content,
                toString: () => content,
            },
        };
    }

    async listFiles(input: ListFilesInput): Promise<ListFilesOutput> {
        const { entries } = await workerFetch<{ entries: Array<{ name: string; type: string }> }>(
            this.workerUrl, '/sandbox/file/list',
            { sandboxId: this.sandboxId, path: input.args.path },
        );
        return {
            files: entries.map(e => ({
                name: e.name,
                type: e.type as 'file' | 'directory',
                isSymlink: false,
            })),
        };
    }

    async deleteFiles(input: DeleteFilesInput): Promise<DeleteFilesOutput> {
        const flag = input.args.recursive === false ? '-f' : '-rf';
        await this.exec(`rm ${flag} ${JSON.stringify(input.args.path)}`);
        return {};
    }

    async renameFile(input: RenameFileInput): Promise<RenameFileOutput> {
        await this.exec(`mv ${JSON.stringify(input.args.oldPath)} ${JSON.stringify(input.args.newPath)}`);
        return {};
    }

    async copyFiles(input: CopyFilesInput): Promise<CopyFileOutput> {
        await this.exec(`cp -r ${JSON.stringify(input.args.sourcePath)} ${JSON.stringify(input.args.targetPath)}`);
        return {};
    }

    async downloadFiles(_input: DownloadFilesInput): Promise<DownloadFilesOutput> {
        // CF sandbox provider does not yet expose a native zip download endpoint.
        // Returning an empty object signals the caller to fall back to listing + reading.
        return {};
    }

    async createDirectory(input: CreateDirectoryInput): Promise<CreateDirectoryOutput> {
        await this.exec(`mkdir -p ${JSON.stringify(input.args.path)}`);
        return {};
    }

    async statFile(input: StatFileInput): Promise<StatFileOutput> {
        const result = await this.exec(`stat -c '{"size":%s,"isDir":"%F"}' ${JSON.stringify(input.args.path)} 2>/dev/null || echo '{"error":true}'`);
        try {
            const parsed = JSON.parse(result.stdout.trim());
            if (parsed.error) {
                return { type: 'file' };
            }
            return {
                type: parsed.isDir === 'directory' ? 'directory' : 'file',
                size: parsed.size,
                isSymlink: false,
            };
        } catch {
            return { type: 'file' };
        }
    }

    // -- terminal & commands -------------------------------------------------

    async createTerminal(_input: CreateTerminalInput): Promise<CreateTerminalOutput> {
        const id = 'default';
        const adapter = this.createTerminalAdapter(id);
        const terminal = new CloudflareTerminal(adapter);
        return { terminal };
    }

    async getTask(input: GetTaskInput): Promise<GetTaskOutput> {
        const id = input?.args?.id || 'dev';
        const adapter = this.createTaskAdapter(id);
        const task = new CloudflareTask(adapter);
        return { task };
    }

    async runCommand(input: TerminalCommandInput): Promise<TerminalCommandOutput> {
        const result = await this.exec(input.args.command);
        return { output: result.stdout + result.stderr };
    }

    async runBackgroundCommand(input: TerminalBackgroundCommandInput): Promise<TerminalBackgroundCommandOutput> {
        const adapter = this.createBgCommandAdapter(input.args.command);
        const command = new CloudflareBackgroundCommand(adapter);
        return { command };
    }

    async watchFiles(_input: WatchFilesInput): Promise<WatchFilesOutput> {
        // File watching via polling — the Worker doesn't support SSE streaming yet
        const watcher = new CloudflareSandboxFileWatcher(this);
        return { watcher };
    }

    async gitStatus(_input: GitStatusInput): Promise<GitStatusOutput> {
        const result = await this.exec('git diff --name-only HEAD 2>/dev/null || echo ""');
        const changedFiles = result.stdout.trim().split('\n').filter(Boolean);
        return { changedFiles };
    }

    // -- adapters for terminal classes ---------------------------------------

    private createTerminalAdapter(id: string): CloudflareSdkTerminal {
        let outputListeners: Array<(data: string) => void> = [];
        const self = this;
        return {
            id,
            name: `cf-terminal-${id}`,
            async open() { return id; },
            async write(data: string) {
                const result = await self.exec(data);
                const output = result.stdout + result.stderr;
                for (const cb of outputListeners) cb(output);
            },
            async run(command: string) {
                const result = await self.exec(command);
                for (const cb of outputListeners) cb(result.stdout + result.stderr);
            },
            async kill() {},
            onOutput(cb: (data: string) => void) {
                outputListeners.push(cb);
                return { dispose() { outputListeners = outputListeners.filter(l => l !== cb); } };
            },
        };
    }

    private createTaskAdapter(name: string): CloudflareSdkTask {
        let outputListeners: Array<(data: string) => void> = [];
        const self = this;
        return {
            id: name,
            name,
            command: name,
            async open() { return name; },
            async run() {
                const result = await self.exec(`echo "Task ${name} started"`);
                for (const cb of outputListeners) cb(result.stdout);
            },
            async restart() {
                for (const cb of outputListeners) cb(`Restarting ${name}...\n`);
            },
            async stop() {},
            onOutput(cb: (data: string) => void) {
                outputListeners.push(cb);
                return { dispose() { outputListeners = outputListeners.filter(l => l !== cb); } };
            },
        };
    }

    private createBgCommandAdapter(command: string): CloudflareSdkCommand {
        let outputListeners: Array<(data: string) => void> = [];
        const self = this;
        return {
            name: undefined,
            command,
            async open() {
                const result = await self.exec(command);
                for (const cb of outputListeners) cb(result.stdout + result.stderr);
                return 'bg-cmd';
            },
            async restart() {
                const result = await self.exec(command);
                for (const cb of outputListeners) cb(result.stdout + result.stderr);
            },
            async kill() {},
            onOutput(cb: (data: string) => void) {
                outputListeners.push(cb);
                return { dispose() { outputListeners = outputListeners.filter(l => l !== cb); } };
            },
        };
    }
}

// ---------------------------------------------------------------------------
// File watcher (polling-based)
// ---------------------------------------------------------------------------

class CloudflareSandboxFileWatcher extends ProviderFileWatcher {
    private interval: ReturnType<typeof setInterval> | null = null;
    private callbacks: Array<(event: WatchEvent) => Promise<void>> = [];
    private lastFileList: string = '';

    constructor(private readonly provider: CloudflareSandboxProvider) {
        super();
    }

    async start(input: WatchFilesInput): Promise<void> {
        const path = input.args.path || '/workspace';
        this.interval = setInterval(async () => {
            try {
                const result = await this.provider.runCommand({ args: { command: `find ${path} -maxdepth 3 -type f 2>/dev/null | sort | head -100` } });
                const fileList = result.output;
                if (fileList !== this.lastFileList && this.lastFileList !== '') {
                    for (const cb of this.callbacks) {
                        await cb({ type: 'change', paths: [path] }).catch(() => {});
                    }
                }
                this.lastFileList = fileList;
            } catch {}
        }, 3000);
    }

    async stop(): Promise<void> {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
    }

    registerEventCallback(callback: (event: WatchEvent) => Promise<void>): void {
        this.callbacks.push(callback);
    }
}

// ---------------------------------------------------------------------------
// Re-exports
// ---------------------------------------------------------------------------

export { CloudflareSandboxProvider as default };
export type { CloudflareProviderOptions } from './types';
export type { CloudflareSandboxConfig, CloudflareSessionInfo } from './types';
