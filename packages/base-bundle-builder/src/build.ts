import {
    normalizeBaseBundleBuildOptions,
    type NormalizeBaseBundleBuildOptionsInput,
} from './build-options';
import {
    createBaseBundleMetroConfig,
    type BaseBundleMetroConfig,
} from './metro-config';
import { createSyntheticBaseBundleEntrySource } from './entry';
import type { BaseBundleBuildOptions } from './options';

export interface BaseBundleMetroBuildRequest {
    readonly options: BaseBundleBuildOptions;
    readonly metroConfig: BaseBundleMetroConfig;
    readonly entrySource: string;
}

export interface BaseBundleMetroBuildResult {
    readonly code: string;
    readonly map?: string;
    readonly modules?: readonly unknown[];
}

export type BaseBundleMetroRunner = (
    request: BaseBundleMetroBuildRequest,
) => Promise<BaseBundleMetroBuildResult> | BaseBundleMetroBuildResult;

export interface BuildBaseBundleInput extends NormalizeBaseBundleBuildOptionsInput {
    readonly runMetroBuild: BaseBundleMetroRunner;
}

export interface BuildBaseBundleResult extends BaseBundleMetroBuildResult {
    readonly options: BaseBundleBuildOptions;
    readonly metroConfig: BaseBundleMetroConfig;
    readonly entrySource: string;
}

export async function buildBaseBundle(
    input: BuildBaseBundleInput,
): Promise<BuildBaseBundleResult> {
    const options = normalizeBaseBundleBuildOptions(input);
    const metroConfig = createBaseBundleMetroConfig(options);
    const entrySource = createSyntheticBaseBundleEntrySource();
    const result = await input.runMetroBuild({
        options,
        metroConfig,
        entrySource,
    });

    if (result.code.trim().length === 0) {
        throw new Error('Base bundle Metro runner returned empty code');
    }

    return {
        ...result,
        options,
        metroConfig,
        entrySource,
    };
}
