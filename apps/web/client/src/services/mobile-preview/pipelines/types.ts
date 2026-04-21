/**
 * Shared editor-side contract for mobile-preview launch and sync pipelines.
 *
 * The browser-only shim path can implement this by checking the local
 * mobile-preview runtime and pushing eval bundles. The builder + relay path
 * can implement the same contract by publishing a generated bundle and
 * returning the relay launch URLs.
 */

export type MobilePreviewPipelineKind = 'shim' | 'two-tier' | 'overlay-v1';

export type MobilePreviewFileEntryType = 'file' | 'directory';

export interface MobilePreviewFileEntry {
    path: string;
    type: MobilePreviewFileEntryType;
}

export type MobilePreviewFileChangeType =
    | 'create'
    | 'update'
    | 'delete'
    | 'rename';

export interface MobilePreviewFileChangeEvent {
    type: MobilePreviewFileChangeType;
    path: string;
}

export interface MobilePreviewPipelineVfs {
    listAll(): Promise<MobilePreviewFileEntry[]>;
    readFile(path: string): Promise<string | Uint8Array>;
    watchDirectory?(
        path: string,
        callback: (event: MobilePreviewFileChangeEvent) => void,
    ): () => void;
}

export interface MobilePreviewPipelineCapabilities {
    /**
     * True when the pipeline can keep an already-open phone session updated
     * without requiring a fresh QR scan.
     */
    liveUpdates: boolean;
    /**
     * True when the pipeline can produce an Onlook app deep link in addition
     * to an Expo-compatible manifest URL.
     */
    onlookDeepLink: boolean;
}

export interface MobilePreviewShimPipelineConfig {
    kind: 'shim';
    serverBaseUrl: string;
}

export interface MobilePreviewTwoTierPipelineConfig {
    kind: 'two-tier';
    builderBaseUrl: string;
    relayBaseUrl: string;
}

export type MobilePreviewPipelineConfig =
    | MobilePreviewShimPipelineConfig
    | MobilePreviewTwoTierPipelineConfig;

export interface MobilePreviewRuntimeStatus {
    runtimeHash: string | null;
    clients: number;
    manifestUrl: string | null;
}

export interface MobilePreviewEvalBundle {
    code: string;
    entryPath: string;
    moduleCount: number;
}

export interface MobilePreviewLaunchTarget {
    pipeline: MobilePreviewPipelineKind;
    /**
     * Expo-compatible manifest URL. This is useful as a fallback even when
     * the QR code points at an Onlook deep link.
     */
    manifestUrl: string;
    /** The URL the editor should encode into the QR code. */
    qrUrl: string;
    /** Onlook app deep link, when the selected pipeline can provide one. */
    onlookUrl?: string;
    runtimeHash?: string | null;
    bundleHash?: string;
    clients?: number;
}

export type MobilePreviewPipelineStatus =
    | { kind: 'idle' }
    | { kind: 'checking-runtime' }
    | { kind: 'preparing' }
    | { kind: 'building' }
    | { kind: 'pushing' }
    | { kind: 'publishing' }
    | { kind: 'ready'; launchTarget: MobilePreviewLaunchTarget }
    | { kind: 'error'; message: string; cause?: unknown };

export type MobilePreviewPipelineStatusCallback = (
    status: MobilePreviewPipelineStatus,
) => void;

export interface MobilePreviewPipelineInputBase {
    fileSystem?: MobilePreviewPipelineVfs;
    projectId?: string;
    branchId?: string;
    signal?: AbortSignal;
    onStatus?: MobilePreviewPipelineStatusCallback;
}

export type MobilePreviewPrepareInput = MobilePreviewPipelineInputBase;

export interface MobilePreviewSyncInput extends MobilePreviewPipelineInputBase {
    fileSystem: MobilePreviewPipelineVfs;
}

export interface MobilePreviewShimSyncResult {
    type: 'eval-push';
    pipeline: 'shim';
    bundle: MobilePreviewEvalBundle;
}

export interface MobilePreviewTwoTierSyncResult {
    type: 'bundle-publish';
    pipeline: 'two-tier';
    launchTarget: MobilePreviewLaunchTarget;
    bundleHash: string;
    bundleSize?: number;
    builtAt?: string;
}

export type MobilePreviewSyncResult =
    | MobilePreviewShimSyncResult
    | MobilePreviewTwoTierSyncResult;

export interface MobilePreviewPipeline<
    TKind extends MobilePreviewPipelineKind = MobilePreviewPipelineKind,
> {
    readonly kind: TKind;
    readonly capabilities: MobilePreviewPipelineCapabilities;
    prepare(input: MobilePreviewPrepareInput): Promise<MobilePreviewLaunchTarget>;
    sync(input: MobilePreviewSyncInput): Promise<MobilePreviewSyncResult>;
    shouldSyncPath(filePath: string): boolean;
    dispose?(): void;
}
