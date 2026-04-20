import type { BaseBundleAssetManifest, BaseBundleAssetManifestEntry } from './assets';
import type { R2ClientConfig } from './r2-client';
import {
    uploadImmutableR2Object,
    type R2UploadClient,
    type R2UploadResult,
    type R2UploadBody,
} from './r2-upload';

export interface BaseBundleAssetUploadEntry extends BaseBundleAssetManifestEntry {
    readonly url: string;
    readonly uploaded: boolean;
}

export interface BaseBundleAssetUploadManifest {
    readonly assets: readonly BaseBundleAssetUploadEntry[];
    readonly uploadedCount: number;
    readonly skippedCount: number;
}

export interface CreateBaseBundleAssetUploaderInput {
    readonly config: R2ClientConfig;
    readonly client: R2UploadClient;
    readonly readAssetBody: (
        asset: BaseBundleAssetManifestEntry,
    ) => R2UploadBody['body'] | Promise<R2UploadBody['body']>;
    readonly uploadObject?: typeof uploadImmutableR2Object;
    readonly force?: boolean;
}

export interface UploadBaseBundleAssetsInput {
    readonly manifest: BaseBundleAssetManifest;
    readonly uploadAsset: (asset: BaseBundleAssetManifestEntry) => Promise<R2UploadResult>;
}

export function createBaseBundleAssetUploader(
    input: CreateBaseBundleAssetUploaderInput,
): (asset: BaseBundleAssetManifestEntry) => Promise<R2UploadResult> {
    const uploadObject = input.uploadObject ?? uploadImmutableR2Object;

    return async (asset) => {
        const body = await input.readAssetBody(asset);

        return uploadObject(input.config, input.client, {
            body,
            ...(input.force !== undefined ? { force: input.force } : {}),
        });
    };
}

export async function uploadBaseBundleAssets(
    input: UploadBaseBundleAssetsInput,
): Promise<BaseBundleAssetUploadManifest> {
    const assets: BaseBundleAssetUploadEntry[] = [];
    let uploadedCount = 0;
    let skippedCount = 0;

    for (const asset of input.manifest.assets) {
        const result = await input.uploadAsset(asset);
        uploadedCount += result.uploaded ? 1 : 0;
        skippedCount += result.uploaded ? 0 : 1;

        assets.push({
            ...asset,
            key: result.key,
            url: result.url,
            uploaded: result.uploaded,
        });
    }

    return {
        assets,
        uploadedCount,
        skippedCount,
    };
}
