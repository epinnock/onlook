import {
    bundleBrowserProject,
    createIncrementalBundler,
    wrapOverlayCode,
    type BrowserBundlerEsbuildService,
    type IncrementalBundler,
} from '../../../../../../../packages/browser-bundler/src';

import { pushOverlay } from '@/services/expo-relay/push-overlay';

import type {
    MobilePreviewPipeline,
    MobilePreviewPipelineCapabilities,
    MobilePreviewPipelineStatusCallback,
    MobilePreviewLaunchTarget,
    MobilePreviewPrepareInput,
    MobilePreviewPipelineVfs,
    MobilePreviewSyncInput,
    MobilePreviewSyncResult,
    MobilePreviewTwoTierPipelineConfig,
    MobilePreviewTwoTierSyncResult,
} from './types';

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'] as const;
const BUNDLED_CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.json']);

/**
 * Bare specifiers that the base bundle provides. Matches the curated
 * registry the browser-bundler's `external` plugin ships with — keep in
 * sync with packages/browser-bundler/src/plugins/external.ts.
 */
const DEFAULT_BASE_EXTERNALS: readonly string[] = [
    'react',
    'react/jsx-runtime',
    'react-native',
    'react-native-safe-area-context',
    'expo',
    'expo-status-bar',
    'expo-router',
    'expo-modules-core',
];

/**
 * Editor injection point for the underlying esbuild service. Production
 * runtime supplies an esbuild-wasm-backed worker client; unit tests inject
 * a fake. If neither has registered one by the time sync() runs, the
 * pipeline throws a clear error rather than hitting a lazy import.
 */
let esbuildServiceFactory: (() => Promise<BrowserBundlerEsbuildService>) | null = null;

export function registerTwoTierEsbuildServiceFactory(
    factory: () => Promise<BrowserBundlerEsbuildService>,
): void {
    esbuildServiceFactory = factory;
}

export function clearTwoTierEsbuildServiceFactory(): void {
    esbuildServiceFactory = null;
}

export const twoTierMobilePreviewCapabilities: MobilePreviewPipelineCapabilities = {
    liveUpdates: true,
    onlookDeepLink: true,
};

export interface TwoTierMobilePreviewPipelineDependencies {
    /**
     * Overrides the global esbuild-service factory. Used by tests to inject
     * a deterministic fake without touching the module-level register.
     */
    readonly esbuildService?: BrowserBundlerEsbuildService;
    /** Session id override. Defaults to a random UUID minted in prepare(). */
    readonly sessionId?: string;
    /** Random id factory override for deterministic tests. */
    readonly createSessionId?: () => string;
    /** Incremental bundler override (defaults to a freshly-constructed one). */
    readonly incrementalBundler?: IncrementalBundler;
}

export class TwoTierMobilePreviewPipeline implements MobilePreviewPipeline<'two-tier'> {
    readonly kind = 'two-tier' as const;
    readonly capabilities = twoTierMobilePreviewCapabilities;

    private readonly config: MobilePreviewTwoTierPipelineConfig;
    private readonly injectedService: BrowserBundlerEsbuildService | null;
    private readonly createSessionId: () => string;
    private readonly incremental: IncrementalBundler;
    private sessionId: string | null;
    private resolvedService: BrowserBundlerEsbuildService | null;

    constructor(
        config: MobilePreviewTwoTierPipelineConfig,
        deps: TwoTierMobilePreviewPipelineDependencies = {},
    ) {
        this.config = config;
        this.injectedService = deps.esbuildService ?? null;
        this.createSessionId =
            deps.createSessionId ??
            (() =>
                typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                    ? crypto.randomUUID()
                    : `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
        this.incremental = deps.incrementalBundler ?? createIncrementalBundler();
        this.sessionId = deps.sessionId ?? null;
        this.resolvedService = this.injectedService;
    }

    async prepare(input: MobilePreviewPrepareInput): Promise<MobilePreviewLaunchTarget> {
        try {
            throwIfAborted(input.signal);
            const { builderBaseUrl, relayBaseUrl } = this.requireConfig();
            emitStatus(input.onStatus, { kind: 'preparing' });

            const sessionId = this.sessionId ?? this.createSessionId();
            this.sessionId = sessionId;

            const trimmedRelay = trimTrailingSlash(relayBaseUrl);
            // TODO(QC-1x): replace with a real base-bundle manifest hash once
            // the base-bundle-builder publishes to R2 and we can resolve it
            // here. Today the mobile client only needs the relay origin +
            // session id; the manifest URL is included for editor-side QR
            // flows that still display a full Expo-compatible URL.
            const manifestUrl = `${trimmedRelay}/manifest/${sessionId}`;

            const launchTarget: MobilePreviewLaunchTarget = {
                pipeline: 'two-tier',
                manifestUrl,
                qrUrl: buildOnlookDeepLink(sessionId, manifestUrl),
                onlookUrl: buildOnlookDeepLink(sessionId, manifestUrl),
                bundleHash: sessionId,
                clients: 0,
            };

            emitStatus(input.onStatus, { kind: 'ready', launchTarget });
            return launchTarget;
        } catch (cause) {
            if (isAbortError(cause)) {
                throw cause;
            }
            const message = formatError(cause);
            emitStatus(input.onStatus, { kind: 'error', message, cause });
            throw new Error(message);
        }
    }

    async sync(input: MobilePreviewSyncInput): Promise<MobilePreviewSyncResult> {
        try {
            throwIfAborted(input.signal);
            const { relayBaseUrl } = this.requireConfig();
            emitStatus(input.onStatus, { kind: 'building' });

            const service = await this.resolveService();
            const files = await collectVirtualFiles(input.fileSystem);
            const entryPoint = pickEntry(files);

            if (!entryPoint) {
                throw new Error(
                    'two-tier pipeline: no supported entry file found (expected one of App.tsx, index.ts, …)',
                );
            }

            const { result, cached } = await this.incremental.build(
                {
                    entryPoint,
                    files,
                    externalSpecifiers: DEFAULT_BASE_EXTERNALS,
                    minify: false,
                    sourcemap: true,
                },
                service,
            );

            const wrapped = wrapOverlayCode(result.code, { sourceMap: result.sourceMap });

            emitStatus(input.onStatus, { kind: 'pushing' });

            const sessionId = this.sessionId ?? this.createSessionId();
            this.sessionId = sessionId;

            const pushResult = await pushOverlay({
                relayBaseUrl,
                sessionId,
                overlay: { code: wrapped.code, sourceMap: result.sourceMap },
            });

            if (!pushResult.ok) {
                throw new Error(`two-tier pipeline: push failed — ${pushResult.error}`);
            }

            const trimmedRelay = trimTrailingSlash(relayBaseUrl);
            const manifestUrl = `${trimmedRelay}/manifest/${sessionId}`;

            const launchTarget: MobilePreviewLaunchTarget = {
                pipeline: 'two-tier',
                manifestUrl,
                qrUrl: buildOnlookDeepLink(sessionId, manifestUrl),
                onlookUrl: buildOnlookDeepLink(sessionId, manifestUrl),
                bundleHash: sessionId,
                clients: pushResult.delivered,
            };

            emitStatus(input.onStatus, { kind: 'ready', launchTarget });

            const syncResult: MobilePreviewTwoTierSyncResult = {
                type: 'bundle-publish',
                pipeline: 'two-tier',
                launchTarget,
                bundleHash: sessionId,
                bundleSize: wrapped.code.length,
            };
            // Side-channel: when the incremental cache hit, the esbuild
            // service never fired. Surface that via status so the UI can
            // tell fast rebuilds apart.
            if (cached) {
                emitStatus(input.onStatus, {
                    kind: 'ready',
                    launchTarget: { ...launchTarget, bundleHash: `${sessionId}@cached` },
                });
            }
            return syncResult;
        } catch (cause) {
            if (isAbortError(cause)) {
                throw cause;
            }
            const message = formatError(cause);
            emitStatus(input.onStatus, { kind: 'error', message, cause });
            throw new Error(message);
        }
    }

    shouldSyncPath(filePath: string): boolean {
        const normalizedPath = normalizePath(filePath);
        if (!normalizedPath) {
            return false;
        }
        if (normalizedPath.includes('node_modules')) {
            return false;
        }
        if (normalizedPath.includes('.onlook/')) {
            return false;
        }
        if (
            normalizedPath === 'package-lock.json' ||
            normalizedPath === 'bun.lock' ||
            normalizedPath === 'bun.lockb'
        ) {
            return false;
        }
        return (
            SOURCE_EXTENSIONS.some((extension) => normalizedPath.endsWith(extension)) ||
            normalizedPath === 'package.json'
        );
    }

    dispose(): void {
        this.incremental.reset();
    }

    private requireConfig(): { builderBaseUrl: string; relayBaseUrl: string } {
        if (!this.config.relayBaseUrl) {
            throw new Error(
                'two-tier pipeline: missing relay base URL — set NEXT_PUBLIC_CF_EXPO_RELAY_URL',
            );
        }
        return {
            builderBaseUrl: this.config.builderBaseUrl,
            relayBaseUrl: this.config.relayBaseUrl,
        };
    }

    private async resolveService(): Promise<BrowserBundlerEsbuildService> {
        if (this.resolvedService) {
            return this.resolvedService;
        }
        if (esbuildServiceFactory) {
            const service = await esbuildServiceFactory();
            this.resolvedService = service;
            return service;
        }
        throw new Error(
            'two-tier pipeline: no esbuild service registered. Call registerTwoTierEsbuildServiceFactory() at editor boot.',
        );
    }
}

export function createTwoTierMobilePreviewPipeline(
    config: MobilePreviewTwoTierPipelineConfig,
    deps: TwoTierMobilePreviewPipelineDependencies = {},
): MobilePreviewPipeline<'two-tier'> {
    return new TwoTierMobilePreviewPipeline(config, deps);
}

// ──────────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────────

async function collectVirtualFiles(
    vfs: MobilePreviewPipelineVfs,
): Promise<Array<{ path: string; contents: string }>> {
    const entries = await vfs.listAll();
    const result: Array<{ path: string; contents: string }> = [];
    for (const entry of entries) {
        if (entry.type !== 'file') {
            continue;
        }
        const normalizedPath = normalizePath(entry.path);
        if (!isBundleableFile(normalizedPath)) {
            continue;
        }
        const raw = await vfs.readFile(normalizedPath);
        const contents = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
        result.push({ path: `/${normalizedPath}`, contents });
    }
    return result;
}

function isBundleableFile(normalizedPath: string): boolean {
    if (!normalizedPath || normalizedPath.includes('node_modules')) {
        return false;
    }
    const extension = lastExtension(normalizedPath);
    return BUNDLED_CODE_EXTENSIONS.has(extension);
}

function lastExtension(filePath: string): string {
    const idx = filePath.lastIndexOf('.');
    if (idx === -1) return '';
    return filePath.slice(idx).toLowerCase();
}

function pickEntry(
    files: ReadonlyArray<{ path: string; contents: string }>,
): string | null {
    // Prefer App.tsx (overlay entry), then index.tsx/ts, then anything that
    // looks entry-like.
    const candidates = ['/App.tsx', '/index.tsx', '/index.ts', '/src/App.tsx', '/src/index.tsx'];
    for (const candidate of candidates) {
        if (files.some((f) => f.path === candidate)) {
            return candidate;
        }
    }
    return null;
}

function buildOnlookDeepLink(sessionId: string, manifestUrl: string): string {
    const params = new URLSearchParams({
        session: sessionId,
        relay: manifestUrl,
    });
    return `onlook://launch?${params.toString()}`;
}

function trimTrailingSlash(input: string): string {
    return input.replace(/\/+$/, '');
}

function normalizePath(inputPath: string): string {
    return inputPath.replace(/\\/g, '/').replace(/^\/+/, '');
}

function emitStatus(
    cb: MobilePreviewPipelineStatusCallback | undefined,
    status: Parameters<MobilePreviewPipelineStatusCallback>[0],
): void {
    try {
        cb?.(status);
    } catch {
        // Status sinks must never affect control flow.
    }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
    if (signal?.aborted) {
        const reason: unknown = (signal as AbortSignal & { reason?: unknown }).reason;
        if (reason instanceof Error) {
            throw reason;
        }
        throw new DOMException('Aborted', 'AbortError');
    }
}

function isAbortError(error: unknown): boolean {
    return (
        error instanceof DOMException && error.name === 'AbortError'
    );
}

function formatError(cause: unknown): string {
    if (cause instanceof Error) {
        return cause.message;
    }
    return String(cause);
}
