/**
 * BuildOrchestrator (TH4.4).
 *
 * One-shot coordinator that glues `createSourceTar` (TH4.2) to
 * `BuilderClient` (TH4.3). A single `build()` call walks the
 * CodeFileSystem, uploads the tar, and polls until the build reaches a
 * terminal state. File-watching + debouncing are intentionally NOT wired
 * here — that happens in the TQ3.2 hook layer.
 */

import type { CodeFileSystem } from '@onlook/file-system';

import { BuilderClient } from './client';
import { createSourceTar } from './source-tar';
import type { BuildStatus } from './types';

export interface BuildOrchestratorOptions {
    fs: CodeFileSystem;
    client: BuilderClient;
    projectId: string;
    branchId: string;
    /**
     * Debounce window for file changes. Default 1000ms. Reserved for the
     * future watcher integration (TQ3.2) — not consumed by `build()`
     * itself.
     */
    debounceMs?: number;
    onStatusChange?: (status: BuildStatus) => void;
}

export class BuildOrchestrator {
    private readonly fs: CodeFileSystem;
    private readonly client: BuilderClient;
    private readonly projectId: string;
    private readonly branchId: string;
    private readonly debounceMs: number;
    private readonly onStatusChange?: (status: BuildStatus) => void;

    private latestStatus: BuildStatus | null = null;
    private abortController: AbortController | null = null;
    private disposed = false;

    constructor(opts: BuildOrchestratorOptions) {
        this.fs = opts.fs;
        this.client = opts.client;
        this.projectId = opts.projectId;
        this.branchId = opts.branchId;
        this.debounceMs = opts.debounceMs ?? 1000;
        this.onStatusChange = opts.onStatusChange;
    }

    /**
     * Debounce window (ms) — exposed so the future watcher hook can read
     * the configured value without poking private fields.
     */
    getDebounceMs(): number {
        return this.debounceMs;
    }

    /**
     * One-shot build: tar the source, POST to cf-esm-builder, wait for
     * the terminal state, and return it. Emits status updates via
     * `onStatusChange` as the build progresses.
     */
    async build(): Promise<BuildStatus> {
        if (this.disposed) {
            throw new Error('BuildOrchestrator is disposed');
        }

        // Cancel any in-flight wait so a new build() supersedes it.
        this.abortController?.abort();
        const controller = new AbortController();
        this.abortController = controller;

        const { tar } = await createSourceTar(this.fs);
        const response = await this.client.postSource(
            tar,
            this.projectId,
            this.branchId,
        );

        const status = await this.client.waitForBuild(response.buildId, {
            signal: controller.signal,
            onUpdate: (s) => {
                this.latestStatus = s;
                this.onStatusChange?.(s);
            },
        });

        this.latestStatus = status;
        this.onStatusChange?.(status);
        return status;
    }

    /**
     * Current (latest known) build status, or null if no build has been
     * started yet.
     */
    getStatus(): BuildStatus | null {
        return this.latestStatus;
    }

    /**
     * Cleans up pending requests. Safe to call multiple times.
     */
    dispose(): void {
        this.disposed = true;
        this.abortController?.abort();
        this.abortController = null;
    }
}
