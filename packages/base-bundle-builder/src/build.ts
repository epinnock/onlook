import {
    createAliasEmitterOutput,
    type AliasEmitterOutput,
    type AliasEmitterModuleRecord,
} from './alias-emitter';
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
    /**
     * Alias-map sidecar derived from the Metro runner's `modules[]` output.
     * `undefined` when the runner did not report modules. When present, the
     * editor-side preflight and the mobile client's OnlookRuntime both
     * consume `sidecarJson` (via the base manifest's `aliasHash`).
     *
     * Wired for two-tier-overlay-v2 task #9.
     */
    readonly aliasEmitterOutput?: AliasEmitterOutput;
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

    const aliasEmitterOutput =
        result.modules !== undefined
            ? createAliasEmitterOutput({
                  modules: result.modules as readonly AliasEmitterModuleRecord[],
              })
            : undefined;

    return {
        ...result,
        options,
        metroConfig,
        entrySource,
        ...(aliasEmitterOutput !== undefined ? { aliasEmitterOutput } : {}),
    };
}
