import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import { spawn, execSync, type ChildProcess } from 'node:child_process';
import { watch, type FSWatcher } from 'chokidar';
import { v4 as uuidv4 } from 'uuid';

import {
    Provider,
    ProviderBackgroundCommand,
    ProviderFileWatcher,
    ProviderTask,
    ProviderTerminal,
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

export interface NodeFsProviderOptions {
    rootDir?: string;
}

export class NodeFsProvider extends Provider {
    private rootDir: string;
    private watchers: NodeFsFileWatcher[] = [];
    private tasks: Map<string, NodeFsTask> = new Map();
    private terminals: Map<string, NodeFsTerminal> = new Map();

    constructor(options: NodeFsProviderOptions) {
        super();
        this.rootDir = options.rootDir || process.cwd();
    }

    private resolve(filePath: string): string {
        // Normalize paths — remove leading ./ or /
        const cleaned = filePath.replace(/^\.\//, '').replace(/^\//, '');
        return path.join(this.rootDir, cleaned);
    }

    async initialize(input: InitializeInput): Promise<InitializeOutput> {
        // Ensure root dir exists
        await fs.mkdir(this.rootDir, { recursive: true });
        return {};
    }

    async writeFile(input: WriteFileInput): Promise<WriteFileOutput> {
        const filePath = this.resolve(input.args.path);
        await fs.mkdir(path.dirname(filePath), { recursive: true });

        if (typeof input.args.content === 'string') {
            await fs.writeFile(filePath, input.args.content, 'utf-8');
        } else {
            await fs.writeFile(filePath, input.args.content);
        }

        return { success: true };
    }

    async renameFile(input: RenameFileInput): Promise<RenameFileOutput> {
        const oldPath = this.resolve(input.args.oldPath);
        const newPath = this.resolve(input.args.newPath);
        await fs.mkdir(path.dirname(newPath), { recursive: true });
        await fs.rename(oldPath, newPath);
        return {};
    }

    async statFile(input: StatFileInput): Promise<StatFileOutput> {
        const filePath = this.resolve(input.args.path);
        const stat = await fs.stat(filePath);
        return {
            type: stat.isDirectory() ? 'directory' : 'file',
        };
    }

    async deleteFiles(input: DeleteFilesInput): Promise<DeleteFilesOutput> {
        const filePath = this.resolve(input.args.path);
        await fs.rm(filePath, { recursive: input.args.recursive ?? true, force: true });
        return {};
    }

    async listFiles(input: ListFilesInput): Promise<ListFilesOutput> {
        const dirPath = this.resolve(input.args.path);
        try {
            const entries = await fs.readdir(dirPath, { withFileTypes: true });
            return {
                files: entries.map((entry) => ({
                    name: entry.name,
                    type: entry.isDirectory() ? 'directory' as const : 'file' as const,
                    isSymlink: entry.isSymbolicLink(),
                })),
            };
        } catch {
            return { files: [] };
        }
    }

    async readFile(input: ReadFileInput): Promise<ReadFileOutput> {
        const filePath = this.resolve(input.args.path);

        // Detect binary files by extension
        const binaryExts = ['.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.pdf', '.zip'];
        const ext = path.extname(filePath).toLowerCase();

        if (binaryExts.includes(ext)) {
            const content = await fs.readFile(filePath);
            return {
                file: {
                    path: input.args.path,
                    content: new Uint8Array(content),
                    type: 'binary',
                    toString: () => content.toString('base64'),
                },
            };
        }

        const content = await fs.readFile(filePath, 'utf-8');
        return {
            file: {
                path: input.args.path,
                content,
                type: 'text',
                toString: () => content,
            },
        };
    }

    async downloadFiles(input: DownloadFilesInput): Promise<DownloadFilesOutput> {
        const filePath = this.resolve(input.args.path);
        return { url: `file://${filePath}` };
    }

    async copyFiles(input: CopyFilesInput): Promise<CopyFileOutput> {
        const src = this.resolve(input.args.sourcePath);
        const dest = this.resolve(input.args.targetPath);
        await fs.mkdir(path.dirname(dest), { recursive: true });
        await fs.cp(src, dest, { recursive: true });
        return {};
    }

    async createDirectory(input: CreateDirectoryInput): Promise<CreateDirectoryOutput> {
        const dirPath = this.resolve(input.args.path);
        await fs.mkdir(dirPath, { recursive: true });
        return {};
    }

    async watchFiles(input: WatchFilesInput): Promise<WatchFilesOutput> {
        const watcher = new NodeFsFileWatcher(this.rootDir, input.args.excludes);
        await watcher.start(input);
        this.watchers.push(watcher);
        return { watcher };
    }

    async createTerminal(input: CreateTerminalInput): Promise<CreateTerminalOutput> {
        const terminal = new NodeFsTerminal(this.rootDir);
        this.terminals.set(terminal.id, terminal);
        return { terminal };
    }

    async getTask(input: GetTaskInput): Promise<GetTaskOutput> {
        const taskId = input.args.id;

        // Return existing task if running
        const existing = this.tasks.get(taskId);
        if (existing) {
            return { task: existing };
        }

        // Create a new task for the dev server
        const task = new NodeFsTask(taskId, this.rootDir);
        this.tasks.set(taskId, task);
        return { task };
    }

    async runCommand(input: TerminalCommandInput): Promise<TerminalCommandOutput> {
        try {
            const output = execSync(input.args.command, {
                cwd: this.rootDir,
                encoding: 'utf-8',
                timeout: 30000,
                stdio: ['pipe', 'pipe', 'pipe'],
            });
            return { output: output || '' };
        } catch (error: any) {
            return { output: error.stdout || error.stderr || error.message };
        }
    }

    async runBackgroundCommand(
        input: TerminalBackgroundCommandInput,
    ): Promise<TerminalBackgroundCommandOutput> {
        const command = new NodeFsCommand(input.args.command, this.rootDir);
        return { command };
    }

    async gitStatus(input: GitStatusInput): Promise<GitStatusOutput> {
        try {
            const output = execSync('git status --porcelain', {
                cwd: this.rootDir,
                encoding: 'utf-8',
            });
            const changedFiles = output
                .split('\n')
                .filter(Boolean)
                .map((line) => line.substring(3).trim());
            return { changedFiles };
        } catch {
            return { changedFiles: [] };
        }
    }

    async setup(input: SetupInput): Promise<SetupOutput> {
        return {};
    }

    async createSession(input: CreateSessionInput): Promise<CreateSessionOutput> {
        return {};
    }

    async reload(): Promise<boolean> {
        return true;
    }

    async reconnect(): Promise<void> {
        // No-op — local filesystem is always connected
    }

    async ping(): Promise<boolean> {
        // Check root dir exists
        try {
            await fs.access(this.rootDir);
            return true;
        } catch {
            return false;
        }
    }

    static async createProject(input: CreateProjectInput): Promise<CreateProjectOutput> {
        // For local projects, the ID is the directory path
        return { id: input.id };
    }

    static async createProjectFromGit(input: {
        repoUrl: string;
        branch: string;
    }): Promise<CreateProjectOutput> {
        const dir = path.join(process.cwd(), `project-${uuidv4().substring(0, 8)}`);
        execSync(`git clone --branch ${input.branch} --single-branch ${input.repoUrl} ${dir}`, {
            encoding: 'utf-8',
        });
        return { id: dir };
    }

    async pauseProject(input: PauseProjectInput): Promise<PauseProjectOutput> {
        return {};
    }

    async stopProject(input: StopProjectInput): Promise<StopProjectOutput> {
        // Kill all tasks
        for (const task of this.tasks.values()) {
            await task.stop();
        }
        return {};
    }

    async listProjects(input: ListProjectsInput): Promise<ListProjectsOutput> {
        return {};
    }

    async destroy(): Promise<void> {
        // Stop all watchers
        for (const watcher of this.watchers) {
            await watcher.stop();
        }
        this.watchers = [];

        // Kill all tasks
        for (const task of this.tasks.values()) {
            await task.stop();
        }
        this.tasks.clear();

        // Kill all terminals
        for (const terminal of this.terminals.values()) {
            await terminal.kill();
        }
        this.terminals.clear();
    }
}

// --- File Watcher ---

export class NodeFsFileWatcher extends ProviderFileWatcher {
    private watcher: FSWatcher | null = null;
    private callback: ((event: WatchEvent) => Promise<void>) | null = null;

    constructor(
        private readonly rootDir: string,
        private readonly excludes?: string[],
    ) {
        super();
    }

    async start(input: WatchFilesInput): Promise<void> {
        const ignored = [
            '**/node_modules/**',
            '**/.git/**',
            '**/.next/**',
            '**/dist/**',
            '**/build/**',
            ...(this.excludes || []),
        ];

        this.watcher = watch(this.rootDir, {
            ignored,
            persistent: true,
            ignoreInitial: true,
            awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
        });

        this.watcher.on('add', (filePath) => {
            const rel = path.relative(this.rootDir, filePath);
            this.callback?.({ type: 'add', paths: [rel] });
        });

        this.watcher.on('change', (filePath) => {
            const rel = path.relative(this.rootDir, filePath);
            this.callback?.({ type: 'change', paths: [rel] });
        });

        this.watcher.on('unlink', (filePath) => {
            const rel = path.relative(this.rootDir, filePath);
            this.callback?.({ type: 'remove', paths: [rel] });
        });
    }

    async stop(): Promise<void> {
        await this.watcher?.close();
        this.watcher = null;
    }

    registerEventCallback(callback: (event: WatchEvent) => Promise<void>): void {
        this.callback = callback;
    }
}

// --- Terminal ---

export class NodeFsTerminal extends ProviderTerminal {
    private _id: string;
    private proc: ChildProcess | null = null;
    private outputCallbacks: ((data: string) => void)[] = [];

    constructor(private readonly cwd: string) {
        super();
        this._id = uuidv4();
    }

    get id(): string {
        return this._id;
    }

    get name(): string {
        return 'terminal';
    }

    async open(): Promise<string> {
        const shell = process.env.SHELL || '/bin/bash';
        this.proc = spawn(shell, ['-l'], {
            cwd: this.cwd,
            env: { ...process.env, TERM: 'xterm-256color' },
            stdio: ['pipe', 'pipe', 'pipe'],
        });

        this.proc.stdout?.on('data', (data: Buffer) => {
            const str = data.toString();
            this.outputCallbacks.forEach((cb) => cb(str));
        });

        this.proc.stderr?.on('data', (data: Buffer) => {
            const str = data.toString();
            this.outputCallbacks.forEach((cb) => cb(str));
        });

        return '';
    }

    async write(data: string): Promise<void> {
        this.proc?.stdin?.write(data);
    }

    async run(command: string): Promise<void> {
        this.proc?.stdin?.write(command + '\n');
    }

    async kill(): Promise<void> {
        this.proc?.kill();
        this.proc = null;
    }

    onOutput(callback: (data: string) => void): () => void {
        this.outputCallbacks.push(callback);
        return () => {
            this.outputCallbacks = this.outputCallbacks.filter((cb) => cb !== callback);
        };
    }
}

// --- Task (dev server) ---

export class NodeFsTask extends ProviderTask {
    private proc: ChildProcess | null = null;
    private outputCallbacks: ((data: string) => void)[] = [];
    private outputBuffer: string = '';

    constructor(
        private readonly _id: string,
        private readonly cwd: string,
    ) {
        super();
    }

    get id(): string {
        return this._id;
    }

    get name(): string {
        return this._id;
    }

    get command(): string {
        return this._id === 'start' ? 'npx expo start --port 8081' : 'npm run dev';
    }

    async open(): Promise<string> {
        if (this.proc) {
            return this.outputBuffer;
        }

        const proc = spawn(this.command, [], {
            cwd: this.cwd,
            env: { ...process.env, TERM: 'xterm-256color', FORCE_COLOR: '1' },
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: true,
        });
        this.proc = proc;

        proc.stdout?.on('data', (data: Buffer) => {
            const str = data.toString();
            this.outputBuffer += str;
            this.outputCallbacks.forEach((cb) => cb(str));
        });

        proc.stderr?.on('data', (data: Buffer) => {
            const str = data.toString();
            this.outputBuffer += str;
            this.outputCallbacks.forEach((cb) => cb(str));
        });

        proc.on('exit', (code) => {
            const msg = `\r\nProcess exited with code ${code}\r\n`;
            this.outputBuffer += msg;
            this.outputCallbacks.forEach((cb) => cb(msg));
        });

        return '';
    }

    async run(): Promise<void> {
        await this.open();
    }

    async restart(): Promise<void> {
        await this.stop();
        this.outputBuffer = '';
        await this.open();
    }

    async stop(): Promise<void> {
        if (this.proc) {
            this.proc.kill('SIGTERM');
            // Wait a bit then force kill
            setTimeout(() => {
                if (this.proc && !this.proc.killed) {
                    this.proc.kill('SIGKILL');
                }
            }, 3000);
            this.proc = null;
        }
    }

    onOutput(callback: (data: string) => void): () => void {
        this.outputCallbacks.push(callback);
        return () => {
            this.outputCallbacks = this.outputCallbacks.filter((cb) => cb !== callback);
        };
    }
}

// --- Background Command ---

export class NodeFsCommand extends ProviderBackgroundCommand {
    private proc: ChildProcess | null;
    private readonly _command: string;
    private outputCallbacks: ((data: string) => void)[] = [];
    private outputBuffer: string = '';

    private cwd: string;

    constructor(cmd: string, cwd: string) {
        super();
        this._command = cmd;
        this.cwd = cwd;
        this.proc = this.spawnProcess();
    }

    private spawnProcess(): ChildProcess {
        const proc = spawn(this._command, [], {
            cwd: this.cwd,
            shell: true,
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env },
        });

        proc.stdout?.on('data', (data: Buffer) => {
            const str = data.toString();
            this.outputBuffer += str;
            this.outputCallbacks.forEach((cb) => cb(str));
        });

        proc.stderr?.on('data', (data: Buffer) => {
            const str = data.toString();
            this.outputBuffer += str;
            this.outputCallbacks.forEach((cb) => cb(str));
        });

        return proc;
    }

    get name(): string {
        return this._command;
    }

    get command(): string {
        return this._command;
    }

    async open(): Promise<string> {
        return this.outputBuffer;
    }

    async restart(): Promise<void> {
        await this.kill();
        this.outputBuffer = '';
        this.proc = this.spawnProcess();
    }

    async kill(): Promise<void> {
        this.proc?.kill();
    }

    onOutput(callback: (data: string) => void): () => void {
        this.outputCallbacks.push(callback);
        return () => {
            this.outputCallbacks = this.outputCallbacks.filter((cb) => cb !== callback);
        };
    }
}
