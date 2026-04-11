/**
 * ExpoBrowserProvider — Wave A wired version.
 *
 * File ops are backed by SupabaseStorageAdapter (TA.5). The dev/start task
 * is a real BrowserTask (TA.6). runCommand goes through the narrow Layer C
 * interceptor (TA.7) and falls through to PROVIDER_NO_SHELL for anything
 * outside the install/uninstall/dev/build allowlist.
 *
 * `getCapabilities().supportsTerminal` is false, so SessionManager
 * (§1.7.2, lands later) skips calling createTerminal entirely. The
 * createTerminal stub here is only invoked by code that hasn't been
 * upgraded yet — it returns an inert ProviderTerminal so existing call
 * sites don't crash.
 *
 * The bundler (browser-metro) doesn't exist in this branch yet; it's a
 * Wave C package. Until then BrowserTask runs without a `triggerBundle`
 * callback, which makes restart() emit a placeholder banner. The bundler
 * gets attached in Wave H §1.3 via the optional `bundlerHost` option.
 *
 * See plans/expo-browser-implementation.md §0.3 for the full method
 * coverage table.
 */
import {
    Provider,
    ProviderBackgroundCommand,
    ProviderFileWatcher,
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
import { BrowserTask, type BrowserTaskHost } from './utils/browser-task';
import { intercept, type InterceptorContext } from './utils/run-command';
import { SupabaseStorageAdapter, type StorageAdapter } from './utils/storage';
import type { ExpoBrowserProviderOptions } from './types';

export type { ExpoBrowserProviderOptions } from './types';

/**
 * Sentinel error message returned by runCommand when the active branch's
 * provider does not support a Linux shell. Tools that surface shell errors
 * to the chat agent should detect this string and adapt.
 */
export const PROVIDER_NO_SHELL =
    'PROVIDER_NO_SHELL: shell unavailable in browser-preview mode. use file edit tools instead.';

const DEFAULT_SUPABASE_URL = 'http://127.0.0.1:54321';

export class ExpoBrowserProvider extends Provider {
    private readonly options: ExpoBrowserProviderOptions;
    private storage: StorageAdapter | null = null;
    private devTask: BrowserTask | null = null;
    private startTask: BrowserTask | null = null;

    constructor(options: ExpoBrowserProviderOptions) {
        super();
        this.options = options;
    }

    // -- lifecycle ----------------------------------------------------------

    async initialize(_input: InitializeInput): Promise<InitializeOutput> {
        // FOUND-R1.7 fix (2026-04-08): prefer the externally-supplied authed
        // Supabase client over creating our own. The editor passes its
        // browser-side singleton (which already has the user's session via
        // the sb-127-auth-token cookie). Without this, the storage adapter
        // creates a fresh GoTrueClient that has no session — Storage RLS
        // then denies all reads even though the user owns the project.
        if (this.options.supabaseClient) {
            this.storage = new SupabaseStorageAdapter({
                projectId: this.options.projectId,
                branchId: this.options.branchId,
                bucket: this.options.storageBucket,
                // supabaseUrl/supabaseKey are unused when client is provided,
                // but the StorageAdapterOptions interface requires them.
                supabaseUrl: this.options.supabaseUrl ?? DEFAULT_SUPABASE_URL,
                supabaseKey: this.options.supabaseAnonKey ?? '',
                client: this.options.supabaseClient,
            });
            return {};
        }
        // Fallback path — caller did not inject a client. Construct one from
        // url + anon key. This path runs anonymously and will hit RLS unless
        // the bucket is explicitly public.
        const supabaseUrl = this.options.supabaseUrl ?? DEFAULT_SUPABASE_URL;
        const supabaseKey = this.options.supabaseAnonKey;
        if (!supabaseKey) {
            throw new Error(
                'ExpoBrowserProvider: either supabaseClient or supabaseAnonKey is required (set NEXT_PUBLIC_SUPABASE_ANON_KEY or pass an authed client from the editor).',
            );
        }
        this.storage = new SupabaseStorageAdapter({
            projectId: this.options.projectId,
            branchId: this.options.branchId,
            bucket: this.options.storageBucket,
            supabaseUrl,
            supabaseKey,
        });
        return {};
    }

    async setup(_input: SetupInput): Promise<SetupOutput> {
        return {};
    }

    async reload(): Promise<boolean> {
        // Triggers a re-bundle on the dev task. Mirrors CSB's reload contract.
        await this.devTask?.restart();
        return true;
    }

    async reconnect(): Promise<void> {
        // No remote connection to re-establish; storage adapter is stateless.
    }

    async ping(): Promise<boolean> {
        return this.storage !== null;
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
        await this.devTask?.stop();
        await this.startTask?.stop();
        this.devTask = null;
        this.startTask = null;
        this.storage = null;
    }

    async createSession(_input: CreateSessionInput): Promise<CreateSessionOutput> {
        return {};
    }

    /**
     * Test/Wave-H seam: attach a real bundler control surface so the dev
     * task's restart() actually runs the browser-metro bundler.
     */
    attachBundler(host: BrowserTaskHost): void {
        if (this.devTask) {
            // Re-create with the new host so the listener wiring is fresh.
            this.devTask = new BrowserTask('dev', host);
        }
        if (this.startTask) {
            this.startTask = new BrowserTask('start', host);
        }
    }

    // -- project lifecycle (no-ops; createProject is a Wave 5 task) ---------

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

    // -- file ops (Supabase Storage) ----------------------------------------

    async writeFile(input: WriteFileInput): Promise<WriteFileOutput> {
        return this.requireStorage().writeFile(input);
    }

    async readFile(input: ReadFileInput): Promise<ReadFileOutput> {
        return this.requireStorage().readFile(input);
    }

    async listFiles(input: ListFilesInput): Promise<ListFilesOutput> {
        return this.requireStorage().listFiles(input);
    }

    async statFile(input: StatFileInput): Promise<StatFileOutput> {
        return this.requireStorage().statFile(input);
    }

    async deleteFiles(input: DeleteFilesInput): Promise<DeleteFilesOutput> {
        return this.requireStorage().deleteFiles(input);
    }

    async renameFile(input: RenameFileInput): Promise<RenameFileOutput> {
        return this.requireStorage().renameFile(input);
    }

    async copyFiles(input: CopyFilesInput): Promise<CopyFileOutput> {
        return this.requireStorage().copyFiles(input);
    }

    async createDirectory(input: CreateDirectoryInput): Promise<CreateDirectoryOutput> {
        return this.requireStorage().createDirectory(input);
    }

    async downloadFiles(input: DownloadFilesInput): Promise<DownloadFilesOutput> {
        return this.requireStorage().downloadFiles(input);
    }

    async watchFiles(_input: WatchFilesInput): Promise<WatchFilesOutput> {
        // Supabase Realtime subscription lands in Wave H. For now return an
        // inert watcher so callers don't crash.
        return { watcher: new ExpoBrowserFileWatcher() };
    }

    async gitStatus(_input: GitStatusInput): Promise<GitStatusOutput> {
        // Wired to isomorphic-git over the local CodeFileSystem in §1.7.3.
        // Until then there's no remote git source — return clean.
        return { changedFiles: [] };
    }

    // -- shell / terminal ---------------------------------------------------

    async createTerminal(_input: CreateTerminalInput): Promise<CreateTerminalOutput> {
        // SessionManager.createTerminalSessions skips this call entirely
        // when getCapabilities().supportsTerminal is false (§1.7.2, lands
        // later). For any caller that hasn't been upgraded yet, return an
        // inert terminal so the bottom panel doesn't crash.
        return { terminal: new ExpoBrowserInertTerminal() };
    }

    async getTask(input: GetTaskInput): Promise<GetTaskOutput> {
        const id = input.args.id;
        if (id === 'dev') {
            if (!this.devTask) this.devTask = new BrowserTask('dev');
            return { task: this.devTask };
        }
        if (id === 'start') {
            if (!this.startTask) this.startTask = new BrowserTask('start');
            return { task: this.startTask };
        }
        // Unknown task — return a fresh BrowserTask anyway. The bundler
        // doesn't differentiate beyond dev/start in Sprint 0.
        return { task: new BrowserTask('dev') };
    }

    async runCommand(input: TerminalCommandInput): Promise<TerminalCommandOutput> {
        return intercept(input, this.interceptorContext());
    }

    async runBackgroundCommand(
        _input: TerminalBackgroundCommandInput,
    ): Promise<TerminalBackgroundCommandOutput> {
        // No background processes in browser-preview mode. Return an inert
        // command that responds with PROVIDER_NO_SHELL on output.
        return { command: new ExpoBrowserInertBackgroundCommand() };
    }

    // -- helpers -------------------------------------------------------------

    private requireStorage(): StorageAdapter {
        if (!this.storage) {
            throw new Error(
                'ExpoBrowserProvider: storage adapter not initialized. Did you forget to call initialize()?',
            );
        }
        return this.storage;
    }

    private interceptorContext(): InterceptorContext {
        return {
            readPackageJson: async () => {
                const { file } = await this.readFile({ args: { path: 'package.json' } });
                return file.toString();
            },
            writePackageJson: async (content) => {
                await this.writeFile({
                    args: { path: 'package.json', content, overwrite: true },
                });
            },
            triggerBundle: async () => {
                await this.devTask?.restart();
            },
            // prefetchPackage is intentionally omitted in Sprint 0; Wave 2
            // wires it to the cf-esm-cache Worker.
        };
    }
}

// -- inert helpers used when capability gates haven't migrated yet ----------

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

class ExpoBrowserInertTerminal extends ProviderTerminal {
    get id(): string {
        return 'expo-browser-terminal-inert';
    }
    get name(): string {
        return 'expo-browser-terminal-inert';
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

class ExpoBrowserInertBackgroundCommand extends ProviderBackgroundCommand {
    get name(): string {
        return 'expo-browser-bg-inert';
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
