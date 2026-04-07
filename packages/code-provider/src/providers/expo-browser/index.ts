/**
 * ExpoBrowserProvider — Sprint 0 stub.
 *
 * Implements the Provider interface with no-op stubs everywhere except for
 * runCommand, which returns the typed PROVIDER_NO_SHELL error so callers
 * can detect that shell is unavailable on this branch.
 *
 * Wave A (Sprint 1) replaces these stubs with:
 *   - Supabase Storage REST adapter for file ops
 *   - BrowserTask for the dev server task
 *   - Layer C narrow interceptor for npm install/run dev/run build patterns
 *
 * See plans/expo-browser-implementation.md §0.3 for the method coverage
 * table and the bigger picture.
 */
import {
    Provider,
    ProviderBackgroundCommand,
    ProviderFileWatcher,
    ProviderTask,
    ProviderTerminal,
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
import type { ExpoBrowserProviderOptions } from './types';

export type { ExpoBrowserProviderOptions } from './types';

/**
 * Sentinel error message returned by runCommand when the active branch's
 * provider does not support a Linux shell. Tools that surface shell errors
 * to the chat agent should detect this string and adapt.
 */
export const PROVIDER_NO_SHELL =
    'PROVIDER_NO_SHELL: shell unavailable in browser-preview mode. use file edit tools instead.';

export class ExpoBrowserProvider extends Provider {
    private readonly options: ExpoBrowserProviderOptions;

    constructor(options: ExpoBrowserProviderOptions) {
        super();
        this.options = options;
    }

    // -- lifecycle (Sprint 0 stubs) -----------------------------------------

    async initialize(_input: InitializeInput): Promise<InitializeOutput> {
        return {};
    }

    async setup(_input: SetupInput): Promise<SetupOutput> {
        return {};
    }

    async reload(): Promise<boolean> {
        return true;
    }

    async reconnect(): Promise<void> {
        // no-op
    }

    async ping(): Promise<boolean> {
        return true;
    }

    getCapabilities(): ProviderCapabilities {
        return {
            supportsTerminal: false,
            supportsShell: false,
            supportsBackgroundCommands: false,
            supportsHibernate: false,
            supportsRemoteScreenshot: false,
        };
    }

    async destroy(): Promise<void> {
        // no-op for Sprint 0
    }

    async createSession(_input: CreateSessionInput): Promise<CreateSessionOutput> {
        return {};
    }

    // -- project lifecycle (Sprint 0 no-ops) --------------------------------

    static async createProject(input: CreateProjectInput): Promise<CreateProjectOutput> {
        // ExpoBrowser does NOT create new branches from scratch in v1.
        // Branches start as CSB (existing flow) and opt into ExpoBrowser
        // via the per-branch settings toggle in §0.5.
        return { id: input.id };
    }

    static async createProjectFromGit(_input: {
        repoUrl: string;
        branch: string;
    }): Promise<CreateProjectOutput> {
        throw new Error('createProjectFromGit not supported on ExpoBrowser provider');
    }

    async pauseProject(_input: PauseProjectInput): Promise<PauseProjectOutput> {
        return {};
    }

    async stopProject(_input: StopProjectInput): Promise<StopProjectOutput> {
        return {};
    }

    async listProjects(_input: ListProjectsInput): Promise<ListProjectsOutput> {
        return {};
    }

    // -- file ops (Sprint 0 stubs; Wave A replaces with Supabase Storage) ---

    async writeFile(_input: WriteFileInput): Promise<WriteFileOutput> {
        return { success: true };
    }

    async readFile(input: ReadFileInput): Promise<ReadFileOutput> {
        return {
            file: {
                path: input.args.path,
                content: '',
                type: 'text',
                toString: () => '',
            },
        };
    }

    async listFiles(_input: ListFilesInput): Promise<ListFilesOutput> {
        return { files: [] };
    }

    async statFile(_input: StatFileInput): Promise<StatFileOutput> {
        return { type: 'file' };
    }

    async deleteFiles(_input: DeleteFilesInput): Promise<DeleteFilesOutput> {
        return {};
    }

    async renameFile(_input: RenameFileInput): Promise<RenameFileOutput> {
        return {};
    }

    async copyFiles(_input: CopyFilesInput): Promise<CopyFileOutput> {
        return {};
    }

    async createDirectory(_input: CreateDirectoryInput): Promise<CreateDirectoryOutput> {
        return {};
    }

    async downloadFiles(_input: DownloadFilesInput): Promise<DownloadFilesOutput> {
        return { url: undefined };
    }

    async watchFiles(_input: WatchFilesInput): Promise<WatchFilesOutput> {
        return { watcher: new ExpoBrowserFileWatcher() };
    }

    async gitStatus(_input: GitStatusInput): Promise<GitStatusOutput> {
        return { changedFiles: [] };
    }

    // -- shell / terminal (PROVIDER_NO_SHELL) -------------------------------

    async createTerminal(_input: CreateTerminalInput): Promise<CreateTerminalOutput> {
        // SessionManager.createTerminalSessions will gate on
        // provider.getCapabilities().supportsTerminal once §1.7.2 lands and
        // skip calling this entirely. Until then, return a no-op terminal so
        // existing call sites don't crash.
        return { terminal: new ExpoBrowserTerminal() };
    }

    async getTask(_input: GetTaskInput): Promise<GetTaskOutput> {
        // Wave A (TA.6) replaces this with a real BrowserTask that triggers
        // bundler.bundle() on restart and pipes bundler events to onOutput.
        return { task: new ExpoBrowserTask() };
    }

    async runCommand(_input: TerminalCommandInput): Promise<TerminalCommandOutput> {
        // Wave A (TA.7) replaces this with the narrow Layer C interceptor
        // that handles npm install/uninstall/run dev/run build patterns.
        return { output: PROVIDER_NO_SHELL };
    }

    async runBackgroundCommand(
        _input: TerminalBackgroundCommandInput,
    ): Promise<TerminalBackgroundCommandOutput> {
        return { command: new ExpoBrowserBackgroundCommand() };
    }
}

// -- inert helpers used only by Sprint 0 stubs --------------------------------

class ExpoBrowserFileWatcher extends ProviderFileWatcher {
    start(_input: WatchFilesInput): Promise<void> {
        return Promise.resolve();
    }
    stop(): Promise<void> {
        return Promise.resolve();
    }
    registerEventCallback(_callback: (event: WatchEvent) => Promise<void>): void {
        // no-op
    }
}

class ExpoBrowserTerminal extends ProviderTerminal {
    get id(): string {
        return 'expo-browser-terminal-stub';
    }
    get name(): string {
        return 'expo-browser-terminal-stub';
    }
    open(): Promise<string> {
        return Promise.resolve(PROVIDER_NO_SHELL);
    }
    write(): Promise<void> {
        return Promise.resolve();
    }
    run(): Promise<void> {
        return Promise.resolve();
    }
    kill(): Promise<void> {
        return Promise.resolve();
    }
    onOutput(_callback: (data: string) => void): () => void {
        return () => {};
    }
}

class ExpoBrowserTask extends ProviderTask {
    get id(): string {
        return 'expo-browser-task-stub';
    }
    get name(): string {
        return 'expo-browser-task-stub';
    }
    get command(): string {
        return 'browser-metro bundle';
    }
    open(): Promise<string> {
        return Promise.resolve('');
    }
    run(): Promise<void> {
        return Promise.resolve();
    }
    restart(): Promise<void> {
        return Promise.resolve();
    }
    stop(): Promise<void> {
        return Promise.resolve();
    }
    onOutput(_callback: (data: string) => void): () => void {
        return () => {};
    }
}

class ExpoBrowserBackgroundCommand extends ProviderBackgroundCommand {
    get name(): string {
        return 'expo-browser-bg-stub';
    }
    get command(): string {
        return PROVIDER_NO_SHELL;
    }
    open(): Promise<string> {
        return Promise.resolve('');
    }
    restart(): Promise<void> {
        return Promise.resolve();
    }
    kill(): Promise<void> {
        return Promise.resolve();
    }
    onOutput(_callback: (data: string) => void): () => void {
        return () => {};
    }
}
