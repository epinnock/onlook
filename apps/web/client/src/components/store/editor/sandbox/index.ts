import { CodeProviderSync } from '@/services/sync-engine/sync-engine';
import { BrowserMetro, type BundleResult } from '@onlook/browser-metro';
import { CodeProvider, ExpoBrowserProvider, type Provider } from '@onlook/code-provider';
import { EXCLUDED_SYNC_PATHS, ProjectType } from '@onlook/constants';
import type { CodeFileSystem } from '@onlook/file-system';
import { type FileEntry } from '@onlook/file-system';
import type { Branch, RouterConfig } from '@onlook/models';
import { makeAutoObservable, reaction } from 'mobx';
import type { EditorEngine } from '../engine';
import type { ErrorManager } from '../error';
import { GitManager } from '../git';
import { detectRouterConfig } from '../pages/helper';
import {
    copyPreloadScriptToPublic,
    detectProjectTypeFromProvider,
    getLayoutPath as detectLayoutPath,
} from './preload-script';
import { SessionManager } from './session';

export enum PreloadScriptState {
    NOT_INJECTED = 'not-injected',
    LOADING = 'loading',
    INJECTED = 'injected'
}
export class SandboxManager {
    readonly session: SessionManager;
    readonly gitManager: GitManager;
    private providerReactionDisposer?: () => void;
    private sync: CodeProviderSync | null = null;
    private bundler: BrowserMetro | null = null;
    private bundlerSubscriptions: Array<() => void> = [];
    // FOUND-R1.5-followup: tracks scheduled re-attach retries when the Vfs
    // is empty at attach time. Bounded to avoid runaway setTimeout loops if
    // the sync never populates the local file system.
    private attachRetryTimer: ReturnType<typeof setTimeout> | null = null;
    private attachRetryCount = 0;
    private static readonly ATTACH_MAX_RETRIES = 10;
    private static readonly ATTACH_RETRY_INTERVAL_MS = 500;
    preloadScriptState: PreloadScriptState = PreloadScriptState.NOT_INJECTED
    routerConfig: RouterConfig | null = null;
    projectType: ProjectType | null = null;
    expoTunnelUrl: string | null = null;

    constructor(
        private branch: Branch,
        private readonly editorEngine: EditorEngine,
        private readonly errorManager: ErrorManager,
        private readonly fs: CodeFileSystem,
    ) {
        this.session = new SessionManager(this.branch, this.errorManager);
        this.session.onExpoUrlDetected = (url) => {
            this.expoTunnelUrl = url;
        };
        this.gitManager = new GitManager(this);
        makeAutoObservable(this);
    }

    async init() {
        // Start connection asynchronously (don't wait)
        if (!this.session.provider) {
            this.session.start(this.branch.sandbox.id).catch(err => {
                console.error('[SandboxManager] Initial connection failed:', err);
                // Don't throw - let reaction handle retries/reconnects
            });
        }

        // React to provider becoming available (now or later)
        this.providerReactionDisposer = reaction(
            () => this.session.provider,
            async (provider) => {
                if (provider) {
                    await this.initializeSyncEngine(provider);
                    await this.gitManager.init();
                } else if (this.sync) {
                    // If the provider is null, release the sync engine reference
                    this.sync.release();
                    this.sync = null;
                }
            },
            { fireImmediately: true },
        );
    }

    async getRouterConfig(): Promise<RouterConfig | null> {
        if (!!this.routerConfig) {
            return this.routerConfig;
        }
        if (!this.session.provider) {
            throw new Error('Provider not initialized');
        }
        this.routerConfig = await detectRouterConfig(this.session.provider);
        return this.routerConfig;
    }

    async getProjectType(): Promise<ProjectType> {
        if (this.projectType) {
            return this.projectType;
        }
        if (!this.session.provider) {
            throw new Error('Provider not initialized');
        }
        this.projectType = await detectProjectTypeFromProvider(
            this.session.provider,
            this.branch.sandbox.id,
            this.branch.sandbox.providerType,
        );
        return this.projectType;
    }

    async initializeSyncEngine(provider: Provider) {
        if (this.sync) {
            this.sync.release();
            this.sync = null;
        }

        this.sync = CodeProviderSync.getInstance(provider, this.fs, this.branch.sandbox.id, {
            exclude: EXCLUDED_SYNC_PATHS,
        });

        await this.sync.start();
        // TR1.5: BrowserMetro reads directly from the local Vfs, so we
        // MUST wait for the sync engine's initial pullFromSandbox() to
        // finish populating the file system. When getInstance() returns
        // an already-running shared instance, start() short-circuits via
        // its `isRunning` guard and returns before the first pull is
        // done — leaving bundler.bundle() to read an empty Vfs and
        // produce `bundled 0 modules` / `Module not found: App.tsx`.
        // Awaiting `firstPullComplete` covers both the first-call and
        // shared-instance paths.
        await this.sync.firstPullComplete;
        await this.ensurePreloadScriptExists();

        // Set Expo mode on the file system so OIDs use dataSet prop
        const projectType = await this.getProjectType();
        if (projectType === ProjectType.EXPO) {
            console.log('[SandboxManager] Setting Expo mode on CodeFileSystem for dataSet OIDs');
            this.fs.setExpoMode(true);
        }

        await this.fs.rebuildIndex();

        // Wave H §1.3 follow-up: wire @onlook/browser-metro into the editor
        // for ExpoBrowser branches. The bundler reads from the local
        // CodeFileSystem (already populated by CodeProviderSync above),
        // bundles via Sucrase, and posts the result to the preview
        // service worker via both BroadcastChannel AND a direct
        // postMessage to the active SW (more reliable across browsers).
        await this.attachBrowserMetro(provider);
    }

    /**
     * Wire @onlook/browser-metro into the editor for ExpoBrowser branches.
     * Idempotent: tearing down any previous bundler before constructing
     * a new one. Called from initializeSyncEngine after the local
     * CodeFileSystem has been populated.
     */
    private async attachBrowserMetro(provider: Provider): Promise<void> {
        console.info('[SandboxManager] attachBrowserMetro called for branch', this.branch.id);

        // Tear down any previous bundler instance
        for (const unsub of this.bundlerSubscriptions) {
            try { unsub(); } catch { /* ignore */ }
        }
        this.bundlerSubscriptions = [];
        if (this.bundler) {
            try { this.bundler.dispose(); } catch { /* ignore */ }
            this.bundler = null;
        }

        // Cancel any in-flight re-attach retry — we're about to either run
        // a fresh attach or schedule a new retry below, so the previous
        // one (if any) is stale.
        if (this.attachRetryTimer !== null) {
            clearTimeout(this.attachRetryTimer);
            this.attachRetryTimer = null;
        }

        // FOUND-R1.5-followup (2026-04-08): defensive guard — even with
        // `sync.firstPullComplete` awaited in `initializeSyncEngine`, a
        // shared `CodeProviderSync` instance (getInstance + refCount > 1)
        // can resolve `firstPullComplete` from a previous consumer's pull,
        // leaving this consumer's view of the Vfs empty. If the Vfs has
        // zero files at this moment, defer the bundler attach until the
        // local file system has been populated. See the follow-up note in
        // `plans/expo-browser-status.md` (2026-04-08).
        const allFiles = await this.fs.listAll();
        if (allFiles.length === 0) {
            if (this.attachRetryCount >= SandboxManager.ATTACH_MAX_RETRIES) {
                console.error(
                    '[SandboxManager] attachBrowserMetro: Vfs still empty after',
                    SandboxManager.ATTACH_MAX_RETRIES,
                    'retries — giving up for branch',
                    this.branch.id,
                );
                this.attachRetryCount = 0;
                return;
            }
            this.attachRetryCount++;
            console.info(
                '[SandboxManager] attachBrowserMetro: Vfs empty, deferring until first file lands (retry',
                this.attachRetryCount,
                'of',
                SandboxManager.ATTACH_MAX_RETRIES,
                ')',
            );
            this.attachRetryTimer = setTimeout(() => {
                this.attachRetryTimer = null;
                // Only retry if the original provider is still the active one —
                // if the session has torn down or swapped providers, bundling
                // for a stale provider would be wrong.
                if (this.session.provider === provider) {
                    void this.attachBrowserMetro(provider);
                }
            }, SandboxManager.ATTACH_RETRY_INTERVAL_MS);
            return;
        }
        // Reset the retry counter once the Vfs has been populated.
        this.attachRetryCount = 0;

        // Only no-shell providers (ExpoBrowser) get a real bundler.
        // Duck-type via getCapabilities() instead of instanceof — Next.js
        // can load the same class from server + client bundles, breaking
        // instanceof checks across the RSC/client boundary.
        const caps = provider.getCapabilities?.();
        const isBrowserPreviewProvider = caps != null && caps.supportsTerminal === false && caps.supportsShell === false;
        console.info('[SandboxManager] attachBrowserMetro: provider caps =', caps, 'isBrowserPreview =', isBrowserPreviewProvider);
        if (!isBrowserPreviewProvider) {
            console.info('[SandboxManager] attachBrowserMetro: provider does not need a browser bundler — skipping');
            return;
        }

        const branchId = this.branch.id;

        const bundler = new BrowserMetro({
            vfs: this.fs,
            esmUrl: process.env.NEXT_PUBLIC_BROWSER_METRO_ESM_URL ?? 'https://esm.sh',
            broadcastChannel: 'onlook-preview',
            logger: {
                debug: (m) => console.debug('[browser-metro]', m),
                info: (m) => console.info('[browser-metro]', m),
                error: (m, e) => console.error('[browser-metro]', m, e),
            },
        });
        this.bundler = bundler;

        // Tag every published bundle with the branchId so the SW can key
        // its cache correctly. The SW listens on both BroadcastChannel
        // AND self.message — we publish on both to maximise reliability.
        const publish = (result: BundleResult) => {
            try {
                const channel = new BroadcastChannel('onlook-preview');
                channel.postMessage({ type: 'bundle', branchId, result });
                channel.close();
            } catch (err) {
                console.error('[SandboxManager] BroadcastChannel publish failed:', err);
            }
            if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
                navigator.serviceWorker.getRegistration('/preview/').then((reg) => {
                    reg?.active?.postMessage({ type: 'bundle', branchId, result });
                }).catch((err) => {
                    console.error('[SandboxManager] SW postMessage failed:', err);
                });
            }
        };

        // Subscribe to bundler updates
        const unsubUpdate = bundler.onUpdate(publish);
        this.bundlerSubscriptions.push(unsubUpdate);

        // Hook the bundler into the provider's BrowserTask so
        // SessionManager.restartDevServer triggers a re-bundle.
        // Cast to ExpoBrowserProvider for the attachBundler() method —
        // we already verified above that the provider is a browser-
        // preview provider via getCapabilities() duck-typing.
        const expoProvider = provider as unknown as ExpoBrowserProvider;
        if (typeof expoProvider.attachBundler === 'function') {
            expoProvider.attachBundler({
                onRebundle: async () => {
                    await bundler.invalidate();
                },
                onStop: async () => {
                    bundler.dispose();
                },
                banner: '[browser-metro] bundling Expo project in your browser…\n',
            });
        }

        // Run the initial bundle now that everything is wired
        try {
            console.info('[SandboxManager] Running initial browser-metro bundle for branch', branchId);
            await bundler.bundle();
        } catch (err) {
            console.error('[SandboxManager] Initial bundle failed:', err);
        }
    }

    private async ensurePreloadScriptExists(): Promise<void> {
        try {
            console.log('[SandboxManager] ensurePreloadScriptExists: current state =', this.preloadScriptState);
            if (this.preloadScriptState !== PreloadScriptState.NOT_INJECTED
            ) {
                console.log('[SandboxManager] Skipping — already', this.preloadScriptState);
                return;
            }

            this.preloadScriptState = PreloadScriptState.LOADING

            if (!this.session.provider) {
                throw new Error('No provider available for preload script injection');
            }

            const projectType = await this.getProjectType();
            console.log('[SandboxManager] Detected projectType:', projectType);

            const routerConfig = projectType === ProjectType.NEXTJS
                ? await this.getRouterConfig()
                : null;
            console.log('[SandboxManager] routerConfig:', routerConfig ? JSON.stringify(routerConfig) : 'null (Expo)');

            console.log('[SandboxManager] Calling copyPreloadScriptToPublic...');
            await copyPreloadScriptToPublic(this.session.provider, projectType, routerConfig, this.branch.sandbox.id);
            this.preloadScriptState = PreloadScriptState.INJECTED
            console.log('[SandboxManager] Preload script state set to INJECTED');
        } catch (error) {
            console.error('[SandboxManager] Failed to ensure preload script exists:', error);
            this.preloadScriptState = PreloadScriptState.NOT_INJECTED
        }
    }

    async getLayoutPath(): Promise<string | null> {
        const routerConfig = await this.getRouterConfig();
        if (!routerConfig) {
            return null;
        }
        return detectLayoutPath(routerConfig, (path) => this.fileExists(path));
    }

    get errors() {
        return this.errorManager.errors;
    }

    get syncEngine() {
        return this.sync;
    }

    async readFile(path: string): Promise<string | Uint8Array> {
        if (!this.fs) throw new Error('File system not initialized');
        return this.fs.readFile(path);
    }

    async writeFile(path: string, content: string | Uint8Array): Promise<void> {
        if (!this.fs) throw new Error('File system not initialized');
        return this.fs.writeFile(path, content);
    }

    listAllFiles() {
        if (!this.fs) throw new Error('File system not initialized');
        return this.fs.listAll();
    }

    async readDir(dir: string): Promise<FileEntry[]> {
        if (!this.fs) throw new Error('File system not initialized');
        return this.fs.readDirectory(dir);
    }

    async listFilesRecursively(dir: string): Promise<string[]> {
        if (!this.fs) throw new Error('File system not initialized');
        return this.fs.listFiles(dir);
    }

    async fileExists(path: string): Promise<boolean> {
        if (!this.fs) throw new Error('File system not initialized');
        return this.fs?.exists(path);
    }

    async copyFile(path: string, targetPath: string): Promise<void> {
        if (!this.fs) throw new Error('File system not initialized');
        return this.fs.copyFile(path, targetPath);
    }

    async copyDirectory(path: string, targetPath: string): Promise<void> {
        if (!this.fs) throw new Error('File system not initialized');
        return this.fs.copyDirectory(path, targetPath);
    }

    async deleteFile(path: string): Promise<void> {
        if (!this.fs) throw new Error('File system not initialized');
        return this.fs.deleteFile(path);
    }

    async deleteDirectory(path: string): Promise<void> {
        if (!this.fs) throw new Error('File system not initialized');
        return this.fs.deleteDirectory(path);
    }

    async rename(oldPath: string, newPath: string): Promise<void> {
        if (!this.fs) throw new Error('File system not initialized');
        return this.fs.moveFile(oldPath, newPath);
    }

    // Download the code as a zip
    async downloadFiles(
        projectName?: string,
    ): Promise<{ downloadUrl: string; fileName: string } | null> {
        if (!this.session.provider) {
            console.error('No sandbox provider found for download');
            return null;
        }

        // Try the provider's native download first
        try {
            const { url } = await this.session.provider.downloadFiles({
                args: {
                    path: './',
                },
            });
            if (url) {
                return {
                    downloadUrl: url,
                    fileName: `${projectName ?? 'onlook-project'}-${Date.now()}.zip`,
                };
            }
        } catch (error) {
            console.warn('Native download failed, falling back to file-by-file download:', error);
        }

        // Fallback: read all files and create a client-side download
        try {
            const { files } = await this.session.provider.listFiles({ args: { path: '.' } });
            if (!files || files.length === 0) {
                console.error('No files found for download');
                return null;
            }

            // Read each file's content
            const fileContents: Array<{ path: string; content: string }> = [];
            for (const file of files) {
                if (file.type === 'file') {
                    try {
                        const { content } = await this.session.provider.readFile({ args: { path: file.path } });
                        if (content) {
                            fileContents.push({ path: file.path, content });
                        }
                    } catch {
                        // Skip files that can't be read
                    }
                }
            }

            // Create a downloadable text bundle (JSON with all files)
            const bundle = JSON.stringify(
                fileContents.reduce((acc, f) => ({ ...acc, [f.path]: f.content }), {}),
                null,
                2,
            );
            const blob = new Blob([bundle], { type: 'application/json' });
            const downloadUrl = URL.createObjectURL(blob);

            return {
                downloadUrl,
                fileName: `${projectName ?? 'onlook-project'}-${Date.now()}.json`,
            };
        } catch (fallbackError) {
            console.error('Fallback download also failed:', fallbackError);
            return null;
        }
    }

    clear() {
        this.providerReactionDisposer?.();
        this.providerReactionDisposer = undefined;
        if (this.attachRetryTimer !== null) {
            clearTimeout(this.attachRetryTimer);
            this.attachRetryTimer = null;
        }
        this.attachRetryCount = 0;
        this.sync?.release();
        this.sync = null;
        this.preloadScriptState = PreloadScriptState.NOT_INJECTED
        this.projectType = null;
        this.routerConfig = null;
        this.session.clear();
    }
}
