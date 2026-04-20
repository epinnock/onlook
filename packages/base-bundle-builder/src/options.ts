export type BaseBundlePlatform = 'ios' | 'android';

export interface BaseBundleBuildOptions {
    readonly projectRoot: string;
    readonly outputDir: string;
    readonly platform: BaseBundlePlatform;
    readonly dev: boolean;
    readonly minify: boolean;
    readonly cacheDir?: string;
}

export interface CreateBaseBundleBuildOptionsInput {
    readonly projectRoot: string;
    readonly outputDir: string;
    readonly platform?: BaseBundlePlatform;
    readonly dev?: boolean;
    readonly minify?: boolean;
    readonly cacheDir?: string;
}

const DEFAULT_PLATFORM: BaseBundlePlatform = 'ios';

export function createBaseBundleBuildOptions(
    input: CreateBaseBundleBuildOptionsInput,
): BaseBundleBuildOptions {
    assertNonEmptyString(input.projectRoot, 'projectRoot');
    assertNonEmptyString(input.outputDir, 'outputDir');

    if (input.cacheDir !== undefined) {
        assertNonEmptyString(input.cacheDir, 'cacheDir');
    }

    return {
        projectRoot: input.projectRoot,
        outputDir: input.outputDir,
        platform: input.platform ?? DEFAULT_PLATFORM,
        dev: input.dev ?? false,
        minify: input.minify ?? true,
        cacheDir: input.cacheDir,
    };
}

export function isBaseBundlePlatform(value: string): value is BaseBundlePlatform {
    return value === 'ios' || value === 'android';
}

function assertNonEmptyString(value: string, fieldName: string): void {
    if (value.trim().length === 0) {
        throw new Error(`Base bundle option "${fieldName}" must be a non-empty string`);
    }
}
