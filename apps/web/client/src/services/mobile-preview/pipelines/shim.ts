import {
    buildMobilePreviewBundle,
    pushMobilePreviewUpdate,
    shouldSyncMobilePreviewPath,
    type MobilePreviewVfs,
} from '../index';

import type {
    MobilePreviewLaunchTarget,
    MobilePreviewPipeline,
    MobilePreviewPipelineStatusCallback,
    MobilePreviewPipelineVfs,
    MobilePreviewPrepareInput,
    MobilePreviewRuntimeStatus,
    MobilePreviewShimPipelineConfig,
    MobilePreviewShimSyncResult,
    MobilePreviewSyncInput,
} from './types';

const MISSING_SERVER_URL_MESSAGE =
    'Missing mobile preview server URL — set NEXT_PUBLIC_MOBILE_PREVIEW_URL.';
const RUNTIME_NOT_STAGED_MESSAGE =
    'mobile-preview server reachable but runtime not staged — restart the server.';

export class MobilePreviewShimPipeline implements MobilePreviewPipeline<'shim'> {
    readonly kind = 'shim' as const;
    readonly capabilities = {
        liveUpdates: true,
        onlookDeepLink: false,
    };

    constructor(private readonly config: MobilePreviewShimPipelineConfig) {}

    async prepare(
        input: MobilePreviewPrepareInput,
    ): Promise<MobilePreviewLaunchTarget> {
        try {
            throwIfAborted(input.signal);
            requireServerBaseUrl(this.config.serverBaseUrl);
            emitStatus(input.onStatus, { kind: 'checking-runtime' });

            const runtimeStatus = await fetchMobilePreviewShimRuntimeStatus(
                this.config,
                input.signal,
            );

            if (!runtimeStatus.manifestUrl) {
                throw new Error(RUNTIME_NOT_STAGED_MESSAGE);
            }

            const launchTarget: MobilePreviewLaunchTarget = {
                pipeline: 'shim',
                manifestUrl: runtimeStatus.manifestUrl,
                qrUrl: runtimeStatus.manifestUrl,
                runtimeHash: runtimeStatus.runtimeHash,
                clients: runtimeStatus.clients,
            };

            emitStatus(input.onStatus, { kind: 'ready', launchTarget });
            return launchTarget;
        } catch (cause) {
            if (isAbortError(cause)) {
                throw cause;
            }

            const message = formatPrepareError(cause);
            emitStatus(input.onStatus, { kind: 'error', message, cause });
            throw new Error(message);
        }
    }

    async sync(input: MobilePreviewSyncInput): Promise<MobilePreviewShimSyncResult> {
        try {
            throwIfAborted(input.signal);
            const serverBaseUrl = requireServerBaseUrl(this.config.serverBaseUrl);
            emitStatus(input.onStatus, { kind: 'building' });

            const bundle = await buildMobilePreviewBundle(
                toMobilePreviewVfs(input.fileSystem),
            );

            throwIfAborted(input.signal);
            emitStatus(input.onStatus, { kind: 'pushing' });

            await pushMobilePreviewUpdate({
                serverBaseUrl,
                code: bundle.code,
            });

            throwIfAborted(input.signal);

            return {
                type: 'eval-push',
                pipeline: 'shim',
                bundle,
            };
        } catch (cause) {
            if (isAbortError(cause)) {
                throw cause;
            }

            const message = formatSyncError(cause);
            emitStatus(input.onStatus, { kind: 'error', message, cause });
            throw new Error(message);
        }
    }

    shouldSyncPath(filePath: string): boolean {
        return shouldSyncMobilePreviewPath(filePath);
    }
}

export function createMobilePreviewShimPipeline(
    config: MobilePreviewShimPipelineConfig,
): MobilePreviewPipeline<'shim'> {
    return new MobilePreviewShimPipeline(config);
}

export async function fetchMobilePreviewShimRuntimeStatus(
    config: MobilePreviewShimPipelineConfig,
    signal?: AbortSignal,
): Promise<MobilePreviewRuntimeStatus> {
    const baseUrl = requireServerBaseUrl(config.serverBaseUrl);
    const res = await fetch(`${baseUrl}/status`, {
        method: 'GET',
        cache: 'no-store',
        signal,
    });

    if (!res.ok) {
        throw new Error(`mobile-preview /status returned ${res.status}`);
    }

    return parseRuntimeStatus(await res.json());
}

function emitStatus(
    onStatus: MobilePreviewPipelineStatusCallback | undefined,
    status: Parameters<MobilePreviewPipelineStatusCallback>[0],
): void {
    onStatus?.(status);
}

function requireServerBaseUrl(serverBaseUrl: string): string {
    const baseUrl = serverBaseUrl.trim().replace(/\/$/, '');
    if (!baseUrl) {
        throw new Error(MISSING_SERVER_URL_MESSAGE);
    }
    return baseUrl;
}

function toMobilePreviewVfs(fileSystem: MobilePreviewPipelineVfs): MobilePreviewVfs {
    return {
        listAll: () => fileSystem.listAll(),
        readFile: (path) => fileSystem.readFile(path),
        watchDirectory:
            fileSystem.watchDirectory ??
            (() => {
                return () => undefined;
            }),
    };
}

function parseRuntimeStatus(body: unknown): MobilePreviewRuntimeStatus {
    if (!isObject(body)) {
        throw new Error('mobile-preview /status returned an invalid response.');
    }

    const { runtimeHash, clients, manifestUrl } = body;
    if (runtimeHash !== null && typeof runtimeHash !== 'string') {
        throw new Error('mobile-preview /status returned an invalid response.');
    }
    if (typeof clients !== 'number' || !Number.isFinite(clients)) {
        throw new Error('mobile-preview /status returned an invalid response.');
    }
    if (manifestUrl !== null && typeof manifestUrl !== 'string') {
        throw new Error('mobile-preview /status returned an invalid response.');
    }

    return {
        runtimeHash,
        clients,
        manifestUrl,
    };
}

function isObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function formatPrepareError(cause: unknown): string {
    const message = toErrorMessage(cause);
    if (
        message === MISSING_SERVER_URL_MESSAGE ||
        message === RUNTIME_NOT_STAGED_MESSAGE ||
        message.startsWith('mobile-preview /status')
    ) {
        return message;
    }
    return `Failed to reach mobile-preview server: ${message}`;
}

function formatSyncError(cause: unknown): string {
    const message = toErrorMessage(cause);
    if (message === MISSING_SERVER_URL_MESSAGE) {
        return message;
    }
    return `Failed to sync app to phone: ${message}`;
}

function toErrorMessage(cause: unknown): string {
    return cause instanceof Error ? cause.message : String(cause);
}

function throwIfAborted(signal: AbortSignal | undefined): void {
    if (!signal?.aborted) {
        return;
    }

    const reason = signal.reason;
    if (reason instanceof Error) {
        throw reason;
    }

    const error = new Error('Mobile preview pipeline request was aborted.');
    error.name = 'AbortError';
    throw error;
}

function isAbortError(cause: unknown): boolean {
    return cause instanceof Error && cause.name === 'AbortError';
}
