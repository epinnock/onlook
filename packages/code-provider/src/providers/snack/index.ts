import {
    Provider,
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
    type WatchFilesInput,
    type WatchFilesOutput,
    type WriteFileInput,
    type WriteFileOutput,
} from '../../types';
import type { SnackProviderOptions } from './types';
import {
    readSnackFile,
    writeSnackFile,
    listSnackFiles,
    deleteSnackFile,
    renameSnackFile,
    downloadSnackFiles,
} from './utils/files';
import { SnackLogTerminal, SnackLogTask, SnackBackgroundCommand } from './utils/terminal';
import { SnackFileWatcher } from './utils/watcher';
import { fetchGitHubRepoAsSnackFiles } from './utils/github';

export type { SnackProviderOptions } from './types';
export type { SnackSessionInfo } from './types';

// ---------------------------------------------------------------------------
// Inline Snack SDK interface to avoid bundling issues
// ---------------------------------------------------------------------------

interface SnackLogListener {
    remove(): void;
}

interface SnackStateListener {
    remove(): void;
}

interface SnackFile {
    type: 'CODE';
    contents: string;
}

interface SnackState {
    files: Record<string, SnackFile | null>;
    online: boolean;
}

interface SnackInstance {
    getState(): SnackState;
    updateFiles(files: Record<string, SnackFile | null>): void;
    setOnline(online: boolean): void;
    addLogListener(cb: (log: { message: string }) => void): SnackLogListener;
    addErrorListener(cb: (error: { message: string }) => void): SnackLogListener;
    addStateListener(
        cb: (state: { files: Record<string, { contents: string }> }) => void,
    ): SnackStateListener;
    reloadConnectedClients?(): void;
    getUrlAsync(): Promise<string>;
    saveAsync?(): Promise<{ id: string }>;
}

// ---------------------------------------------------------------------------
// SnackProvider
// ---------------------------------------------------------------------------

export class SnackProvider extends Provider {
    private snack: SnackInstance | null = null;

    constructor(public readonly options: SnackProviderOptions) {
        super();
    }

    // -- Lifecycle -----------------------------------------------------------

    async initialize(_input: InitializeInput): Promise<InitializeOutput> {
        // Dynamically import snack-sdk to avoid bundling issues.
        // The Snack constructor accepts the same shape as SnackProviderOptions.
        const { default: Snack } = await import('snack-sdk');
        this.snack = new (Snack as any)({
            name: this.options.name,
            description: this.options.description,
            sdkVersion: this.options.sdkVersion,
            files: this.options.initialFiles,
            dependencies: this.options.dependencies,
        }) as SnackInstance;
        this.snack.setOnline(true);
        return {};
    }

    async setup(_input: SetupInput): Promise<SetupOutput> {
        // No-op: Snack does not have a setup step.
        return {};
    }

    async reload(): Promise<boolean> {
        if (!this.snack) {
            return false;
        }
        this.snack.reloadConnectedClients?.();
        return true;
    }

    async reconnect(): Promise<void> {
        if (this.snack) {
            this.snack.setOnline(true);
        }
    }

    async ping(): Promise<boolean> {
        if (!this.snack) {
            return false;
        }
        return this.snack.getState().online;
    }

    async destroy(): Promise<void> {
        this.snack = null;
    }

    // -- Session / Project management ----------------------------------------

    async createSession(_input: CreateSessionInput): Promise<CreateSessionOutput> {
        // No-op: Snack sessions are managed by the SDK itself.
        return {};
    }

    async pauseProject(_input: PauseProjectInput): Promise<PauseProjectOutput> {
        // No-op: Snack is serverless — no project to pause.
        return {};
    }

    async stopProject(_input: StopProjectInput): Promise<StopProjectOutput> {
        // No-op: Snack is serverless — no project to stop.
        return {};
    }

    async listProjects(_input: ListProjectsInput): Promise<ListProjectsOutput> {
        // No-op: Snack does not expose a project listing API.
        return {};
    }

    static async createProject(input: CreateProjectInput): Promise<CreateProjectOutput> {
        const { default: Snack } = await import('snack-sdk');
        const snack = new (Snack as any)({
            name: input.title ?? 'Untitled',
            description: input.description ?? '',
        }) as SnackInstance;
        snack.setOnline(true);

        let id = input.id;
        if (snack.saveAsync) {
            const saved = await snack.saveAsync();
            id = saved.id;
        }
        return { id };
    }

    static async createProjectFromGit(input: {
        repoUrl: string;
        branch: string;
    }): Promise<CreateProjectOutput> {
        const files = await fetchGitHubRepoAsSnackFiles(input.repoUrl, input.branch);

        const { default: Snack } = await import('snack-sdk');
        const snack = new (Snack as any)({
            name: 'Imported from GitHub',
            files,
        }) as SnackInstance;
        snack.setOnline(true);

        let id = 'snack-git-import';
        if (snack.saveAsync) {
            const saved = await snack.saveAsync();
            id = saved.id;
        }
        return { id };
    }

    // -- File operations -----------------------------------------------------

    async readFile(input: ReadFileInput): Promise<ReadFileOutput> {
        const state = this.getSnackState();
        const contents = readSnackFile(state, input.args.path);

        if (contents === null) {
            throw new Error(`File not found: ${input.args.path}`);
        }

        const file = {
            type: 'text' as const,
            path: input.args.path,
            content: contents,
            toString: () => contents,
        };
        return { file };
    }

    async writeFile(input: WriteFileInput): Promise<WriteFileOutput> {
        this.ensureSnack();
        const content =
            typeof input.args.content === 'string'
                ? input.args.content
                : new TextDecoder().decode(input.args.content);
        writeSnackFile(this.snack!, input.args.path, content);
        return { success: true };
    }

    async listFiles(input: ListFilesInput): Promise<ListFilesOutput> {
        const state = this.getSnackState();
        const entries = listSnackFiles(state, input.args.path);
        return {
            files: entries.map((e) => ({
                name: e.name,
                type: e.type,
                isSymlink: false,
            })),
        };
    }

    async deleteFiles(input: DeleteFilesInput): Promise<DeleteFilesOutput> {
        this.ensureSnack();
        // If recursive, delete all files under the path prefix.
        if (input.args.recursive) {
            const state = this.snack!.getState();
            for (const filePath of Object.keys(state.files)) {
                if (filePath === input.args.path || filePath.startsWith(input.args.path + '/')) {
                    deleteSnackFile(this.snack!, filePath);
                }
            }
        } else {
            deleteSnackFile(this.snack!, input.args.path);
        }
        return {};
    }

    async renameFile(input: RenameFileInput): Promise<RenameFileOutput> {
        this.ensureSnack();
        renameSnackFile(this.snack!, input.args.oldPath, input.args.newPath);
        return {};
    }

    async copyFiles(input: CopyFilesInput): Promise<CopyFileOutput> {
        this.ensureSnack();
        const state = this.snack!.getState();
        const contents = readSnackFile(state, input.args.sourcePath);
        if (contents === null) {
            throw new Error(`Source file not found: ${input.args.sourcePath}`);
        }
        writeSnackFile(this.snack!, input.args.targetPath, contents);
        return {};
    }

    async downloadFiles(input: DownloadFilesInput): Promise<DownloadFilesOutput> {
        const state = this.getSnackState();
        const result = downloadSnackFiles(state, [input.args.path]);
        // downloadSnackFiles returns a Map; Snack has no URL-based download.
        // Return undefined url since the content is already in-memory.
        if (result.size === 0) {
            return { url: undefined };
        }
        return { url: undefined };
    }

    async createDirectory(_input: CreateDirectoryInput): Promise<CreateDirectoryOutput> {
        // No-op: Snack uses flat paths — directories are virtual.
        return {};
    }

    async statFile(input: StatFileInput): Promise<StatFileOutput> {
        const state = this.getSnackState();
        const path = input.args.path.replace(/^\/+|\/+$/g, '');

        // Check if path is an exact file.
        const entry = state.files[path];
        if (entry && entry.type === 'CODE') {
            return { type: 'file' };
        }

        // Check if path is a virtual directory (any file starts with path/).
        const prefix = path + '/';
        for (const filePath of Object.keys(state.files)) {
            if (filePath.startsWith(prefix) && state.files[filePath] !== null) {
                return { type: 'directory' };
            }
        }

        throw new Error(`Path not found: ${input.args.path}`);
    }

    // -- Terminal / Commands --------------------------------------------------

    async createTerminal(_input: CreateTerminalInput): Promise<CreateTerminalOutput> {
        this.ensureSnack();
        return { terminal: new SnackLogTerminal(this.snack!) };
    }

    async getTask(input: GetTaskInput): Promise<GetTaskOutput> {
        this.ensureSnack();
        return { task: new SnackLogTask(this.snack!) };
    }

    async runCommand(_input: TerminalCommandInput): Promise<TerminalCommandOutput> {
        return { output: '[Snack] Shell not available' };
    }

    async runBackgroundCommand(
        _input: TerminalBackgroundCommandInput,
    ): Promise<TerminalBackgroundCommandOutput> {
        return { command: new SnackBackgroundCommand() };
    }

    // -- Watch / Git ----------------------------------------------------------

    async watchFiles(input: WatchFilesInput): Promise<WatchFilesOutput> {
        this.ensureSnack();
        // Cast: SnackFileWatcher's SnackLike expects non-nullable file entries.
        // At runtime the Snack SDK's state listener only delivers live files.
        const watcher = new SnackFileWatcher(this.snack! as any);
        await watcher.start(input);

        if (input.onFileChange) {
            watcher.registerEventCallback(async (event) => {
                if (input.onFileChange) {
                    await input.onFileChange({
                        type: event.type,
                        paths: event.paths,
                    });
                }
            });
        }

        return { watcher };
    }

    async gitStatus(_input: GitStatusInput): Promise<GitStatusOutput> {
        // Snack has no git integration.
        return { changedFiles: [] };
    }

    // -- Private helpers ------------------------------------------------------

    private ensureSnack(): void {
        if (!this.snack) {
            throw new Error('SnackProvider not initialized. Call initialize() first.');
        }
    }

    private getSnackState(): SnackState {
        this.ensureSnack();
        return this.snack!.getState();
    }
}
