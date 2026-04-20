import type {
    MobilePreviewPipeline,
    MobilePreviewPipelineCapabilities,
    MobilePreviewPipelineStatusCallback,
    MobilePreviewLaunchTarget,
    MobilePreviewPrepareInput,
    MobilePreviewSyncInput,
    MobilePreviewSyncResult,
    MobilePreviewTwoTierPipelineConfig,
} from './types';

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'] as const;
const NOT_IMPLEMENTED_MESSAGE =
    'The two-tier mobile preview pipeline is not implemented yet.';

export const twoTierMobilePreviewCapabilities: MobilePreviewPipelineCapabilities = {
    liveUpdates: true,
    onlookDeepLink: true,
};

export class TwoTierMobilePreviewPipeline implements MobilePreviewPipeline<'two-tier'> {
    readonly kind = 'two-tier' as const;
    readonly capabilities = twoTierMobilePreviewCapabilities;

    constructor(private readonly config: MobilePreviewTwoTierPipelineConfig) {}

    async prepare(input: MobilePreviewPrepareInput): Promise<MobilePreviewLaunchTarget> {
        input.onStatus?.({ kind: 'preparing' });
        throw createNotImplementedError(this.config, input.onStatus);
    }

    async sync(input: MobilePreviewSyncInput): Promise<MobilePreviewSyncResult> {
        input.onStatus?.({ kind: 'building' });
        throw createNotImplementedError(this.config, input.onStatus);
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
}

export function createTwoTierMobilePreviewPipeline(
    config: MobilePreviewTwoTierPipelineConfig,
): MobilePreviewPipeline<'two-tier'> {
    return new TwoTierMobilePreviewPipeline(config);
}

function createNotImplementedError(
    config: MobilePreviewTwoTierPipelineConfig,
    onStatus?: MobilePreviewPipelineStatusCallback,
): Error {
    const error = new Error(
        `${NOT_IMPLEMENTED_MESSAGE} builder=${config.builderBaseUrl} relay=${config.relayBaseUrl}`,
    );
    onStatus?.({
        kind: 'error',
        message: NOT_IMPLEMENTED_MESSAGE,
        cause: error,
    });
    return error;
}

function normalizePath(filePath: string): string {
    return filePath.replace(/\\/g, '/').replace(/^\/+/, '');
}
