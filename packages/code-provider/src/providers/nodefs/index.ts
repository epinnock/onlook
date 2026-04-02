/**
 * NodeFs Provider — Local filesystem provider for running projects directly on the machine.
 *
 * IMPORTANT: All Node.js modules (fs, path, child_process, chokidar) are loaded lazily
 * via ensureNodeModules() to prevent them from being bundled in client/browser code.
 * This module should only be instantiated on the server via dynamic import().
 */

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

// Lazy-loaded Node.js modules — never imported at the top level
let _fs: typeof import('node:fs/promises') | null = null;
let _path: typeof import('node:path') | null = null;
let _cp: typeof import('node:child_process') | null = null;
let _chokidar: typeof import('chokidar') | null = null;

async function ensureNodeModules() {
    if (_fs) return;
    _fs = await import('node:fs/promises');
    _path = await import('node:path');
    _cp = await import('node:child_process');
    _chokidar = await import('chokidar');
}

function fs() { return _fs!; }
function nodePath() { return _path!; }
function cp() { return _cp!; }
function chok() { return _chokidar!; }

function makeId(): string {
    return Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
}

type ChildProcess = import('node:child_process').ChildProcess;

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
        const cleaned = filePath.replace(/^\.\//, '').replace(/^\//, '');
        return nodePath().join(this.rootDir, cleaned);
    }

    async initialize(input: InitializeInput): Promise<InitializeOutput> {
        await ensureNodeModules();
        await fs().mkdir(this.rootDir, { recursive: true });
        return {};
    }

    async writeFile(input: WriteFileInput): Promise<WriteFileOutput> {
        const filePath = this.resolve(input.args.path);
        await fs().mkdir(nodePath().dirname(filePath), { recursive: true });
        if (typeof input.args.content === 'string') {
            await fs().writeFile(filePath, input.args.content, 'utf-8');
        } else {
            await fs().writeFile(filePath, input.args.content);
        }
        return { success: true };
    }

    async renameFile(input: RenameFileInput): Promise<RenameFileOutput> {
        const oldPath = this.resolve(input.args.oldPath);
        const newPath = this.resolve(input.args.newPath);
        await fs().mkdir(nodePath().dirname(newPath), { recursive: true });
        await fs().rename(oldPath, newPath);
        return {};
    }

    async statFile(input: StatFileInput): Promise<StatFileOutput> {
        const filePath = this.resolve(input.args.path);
        const stat = await fs().stat(filePath);
        return { type: stat.isDirectory() ? 'directory' : 'file' };
    }

    async deleteFiles(input: DeleteFilesInput): Promise<DeleteFilesOutput> {
        const filePath = this.resolve(input.args.path);
        await fs().rm(filePath, { recursive: input.args.recursive ?? true, force: true });
        return {};
    }

    async listFiles(input: ListFilesInput): Promise<ListFilesOutput> {
        const dirPath = this.resolve(input.args.path);
        try {
            const entries = await fs().readdir(dirPath, { withFileTypes: true });
            return {
                files: entries.map((e) => ({
                    name: e.name,
                    type: e.isDirectory() ? 'directory' as const : 'file' as const,
                    isSymlink: e.isSymbolicLink(),
                })),
            };
        } catch {
            return { files: [] };
        }
    }

    async readFile(input: ReadFileInput): Promise<ReadFileOutput> {
        const filePath = this.resolve(input.args.path);
        const binaryExts = ['.png', '.jpg', '.jpeg', '.gif', '.ico', '.woff', '.woff2', '.ttf', '.eot', '.pdf', '.zip'];
        const ext = nodePath().extname(filePath).toLowerCase();

        if (binaryExts.includes(ext)) {
            const content = await fs().readFile(filePath);
            return {
                file: {
                    path: input.args.path,
                    content: new Uint8Array(content),
                    type: 'binary',
                    toString: () => content.toString('base64'),
                },
            };
        }

        const content = await fs().readFile(filePath, 'utf-8');
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
        return { url: `file://${this.resolve(input.args.path)}` };
    }

    async copyFiles(input: CopyFilesInput): Promise<CopyFileOutput> {
        const src = this.resolve(input.args.sourcePath);
        const dest = this.resolve(input.args.targetPath);
        await fs().mkdir(nodePath().dirname(dest), { recursive: true });
        await fs().cp(src, dest, { recursive: true });
        return {};
    }

    async createDirectory(input: CreateDirectoryInput): Promise<CreateDirectoryOutput> {
        await fs().mkdir(this.resolve(input.args.path), { recursive: true });
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
        const existing = this.tasks.get(input.args.id);
        if (existing) return { task: existing };
        const task = new NodeFsTask(input.args.id, this.rootDir);
        this.tasks.set(input.args.id, task);
        return { task };
    }

    async runCommand(input: TerminalCommandInput): Promise<TerminalCommandOutput> {
        try {
            const output = cp().execSync(input.args.command, {
                cwd: this.rootDir, encoding: 'utf-8', timeout: 30000, stdio: ['pipe', 'pipe', 'pipe'],
            });
            return { output: output || '' };
        } catch (error: any) {
            return { output: error.stdout || error.stderr || error.message };
        }
    }

    async runBackgroundCommand(input: TerminalBackgroundCommandInput): Promise<TerminalBackgroundCommandOutput> {
        return { command: new NodeFsCommand(input.args.command, this.rootDir) };
    }

    async gitStatus(input: GitStatusInput): Promise<GitStatusOutput> {
        try {
            const output = cp().execSync('git status --porcelain', { cwd: this.rootDir, encoding: 'utf-8' });
            return { changedFiles: output.split('\n').filter(Boolean).map((l) => l.substring(3).trim()) };
        } catch {
            return { changedFiles: [] };
        }
    }

    async setup(input: SetupInput): Promise<SetupOutput> { return {}; }
    async createSession(input: CreateSessionInput): Promise<CreateSessionOutput> { return {}; }
    async reload(): Promise<boolean> { return true; }
    async reconnect(): Promise<void> {}

    async ping(): Promise<boolean> {
        try { await fs().access(this.rootDir); return true; } catch { return false; }
    }

    static async createProject(input: CreateProjectInput): Promise<CreateProjectOutput> {
        return { id: input.id };
    }

    static async createProjectFromGit(input: { repoUrl: string; branch: string }): Promise<CreateProjectOutput> {
        await ensureNodeModules();
        const dir = nodePath().join(process.cwd(), `project-${makeId()}`);
        cp().execSync(`git clone --branch ${input.branch} --single-branch ${input.repoUrl} ${dir}`, { encoding: 'utf-8' });
        return { id: dir };
    }

    async pauseProject(input: PauseProjectInput): Promise<PauseProjectOutput> { return {}; }
    async stopProject(input: StopProjectInput): Promise<StopProjectOutput> {
        for (const task of this.tasks.values()) await task.stop();
        return {};
    }
    async listProjects(input: ListProjectsInput): Promise<ListProjectsOutput> { return {}; }

    async destroy(): Promise<void> {
        for (const w of this.watchers) await w.stop();
        this.watchers = [];
        for (const t of this.tasks.values()) await t.stop();
        this.tasks.clear();
        for (const t of this.terminals.values()) await t.kill();
        this.terminals.clear();
    }
}

// --- File Watcher ---

export class NodeFsFileWatcher extends ProviderFileWatcher {
    private watcher: FSWatcher | null = null;
    private callback: ((event: WatchEvent) => Promise<void>) | null = null;

    constructor(private readonly rootDir: string, private readonly excludes?: string[]) {
        super();
    }

    async start(input: WatchFilesInput): Promise<void> {
        await ensureNodeModules();
        const ignored = ['**/node_modules/**', '**/.git/**', '**/.next/**', '**/dist/**', '**/build/**', ...(this.excludes || [])];
        this.watcher = chok().watch(this.rootDir, { ignored, persistent: true, ignoreInitial: true, awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 } });
        this.watcher.on('add', (fp) => { this.callback?.({ type: 'add', paths: [nodePath().relative(this.rootDir, fp)] }); });
        this.watcher.on('change', (fp) => { this.callback?.({ type: 'change', paths: [nodePath().relative(this.rootDir, fp)] }); });
        this.watcher.on('unlink', (fp) => { this.callback?.({ type: 'remove', paths: [nodePath().relative(this.rootDir, fp)] }); });
    }

    async stop(): Promise<void> { await this.watcher?.close(); this.watcher = null; }
    registerEventCallback(callback: (event: WatchEvent) => Promise<void>): void { this.callback = callback; }
}

// --- Terminal ---

export class NodeFsTerminal extends ProviderTerminal {
    private _id = makeId();
    private proc: ChildProcess | null = null;
    private outputCallbacks: ((data: string) => void)[] = [];

    constructor(private readonly cwd: string) { super(); }

    get id(): string { return this._id; }
    get name(): string { return 'terminal'; }

    async open(): Promise<string> {
        await ensureNodeModules();
        const shell = process.env.SHELL || '/bin/bash';
        this.proc = cp().spawn(shell, ['-l'], { cwd: this.cwd, env: { ...process.env, TERM: 'xterm-256color' }, stdio: ['pipe', 'pipe', 'pipe'] });
        this.proc.stdout?.on('data', (d: Buffer) => { const s = d.toString(); this.outputCallbacks.forEach((cb) => cb(s)); });
        this.proc.stderr?.on('data', (d: Buffer) => { const s = d.toString(); this.outputCallbacks.forEach((cb) => cb(s)); });
        return '';
    }

    async write(data: string): Promise<void> { this.proc?.stdin?.write(data); }
    async run(command: string): Promise<void> { this.proc?.stdin?.write(command + '\n'); }
    async kill(): Promise<void> { this.proc?.kill(); this.proc = null; }
    onOutput(callback: (data: string) => void): () => void {
        this.outputCallbacks.push(callback);
        return () => { this.outputCallbacks = this.outputCallbacks.filter((cb) => cb !== callback); };
    }
}

// --- Task (dev server) ---

export class NodeFsTask extends ProviderTask {
    private proc: ChildProcess | null = null;
    private outputCallbacks: ((data: string) => void)[] = [];
    private outputBuffer = '';

    constructor(private readonly _id: string, private readonly cwd: string) { super(); }

    get id(): string { return this._id; }
    get name(): string { return this._id; }
    get command(): string { return this._id === 'start' ? 'npx expo start --port 8081' : 'npm run dev'; }

    async open(): Promise<string> {
        if (this.proc) return this.outputBuffer;
        await ensureNodeModules();
        const proc = cp().spawn(this.command, [], { cwd: this.cwd, env: { ...process.env, TERM: 'xterm-256color', FORCE_COLOR: '1' }, stdio: ['pipe', 'pipe', 'pipe'], shell: true });
        this.proc = proc;
        proc.stdout?.on('data', (d: Buffer) => { const s = d.toString(); this.outputBuffer += s; this.outputCallbacks.forEach((cb) => cb(s)); });
        proc.stderr?.on('data', (d: Buffer) => { const s = d.toString(); this.outputBuffer += s; this.outputCallbacks.forEach((cb) => cb(s)); });
        proc.on('exit', (code) => { const m = `\r\nProcess exited with code ${code}\r\n`; this.outputBuffer += m; this.outputCallbacks.forEach((cb) => cb(m)); });
        return '';
    }

    async run(): Promise<void> { await this.open(); }
    async restart(): Promise<void> { await this.stop(); this.outputBuffer = ''; await this.open(); }
    async stop(): Promise<void> {
        if (this.proc) {
            this.proc.kill('SIGTERM');
            const p = this.proc;
            setTimeout(() => { if (p && !p.killed) p.kill('SIGKILL'); }, 3000);
            this.proc = null;
        }
    }
    onOutput(callback: (data: string) => void): () => void {
        this.outputCallbacks.push(callback);
        return () => { this.outputCallbacks = this.outputCallbacks.filter((cb) => cb !== callback); };
    }
}

// --- Background Command ---

export class NodeFsCommand extends ProviderBackgroundCommand {
    private proc: ChildProcess | null;
    private readonly _command: string;
    private outputCallbacks: ((data: string) => void)[] = [];
    private outputBuffer = '';
    private cwd: string;

    constructor(cmd: string, cwd: string) {
        super();
        this._command = cmd;
        this.cwd = cwd;
        // Spawn immediately — ensureNodeModules must have been called by the provider already
        this.proc = this.spawnProcess();
    }

    private spawnProcess(): ChildProcess | null {
        if (!_cp) return null;
        const proc = _cp.spawn(this._command, [], { cwd: this.cwd, shell: true, stdio: ['pipe', 'pipe', 'pipe'], env: { ...process.env } });
        proc.stdout?.on('data', (d: Buffer) => { const s = d.toString(); this.outputBuffer += s; this.outputCallbacks.forEach((cb) => cb(s)); });
        proc.stderr?.on('data', (d: Buffer) => { const s = d.toString(); this.outputBuffer += s; this.outputCallbacks.forEach((cb) => cb(s)); });
        return proc;
    }

    get name(): string { return this._command; }
    get command(): string { return this._command; }
    async open(): Promise<string> { return this.outputBuffer; }
    async restart(): Promise<void> { await this.kill(); this.outputBuffer = ''; this.proc = this.spawnProcess(); }
    async kill(): Promise<void> { this.proc?.kill(); this.proc = null; }
    onOutput(callback: (data: string) => void): () => void {
        this.outputCallbacks.push(callback);
        return () => { this.outputCallbacks = this.outputCallbacks.filter((cb) => cb !== callback); };
    }
}
