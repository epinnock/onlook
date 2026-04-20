import { resolve } from 'node:path';

import {
    createBaseBundleBuildOptions,
    type BaseBundleBuildOptions,
    type CreateBaseBundleBuildOptionsInput,
} from './options';

export interface NormalizeBaseBundleBuildOptionsInput
    extends CreateBaseBundleBuildOptionsInput {
    readonly cwd?: string;
}

export function normalizeBaseBundleBuildOptions(
    input: NormalizeBaseBundleBuildOptionsInput,
): BaseBundleBuildOptions {
    const cwd = input.cwd ?? process.cwd();
    const options = createBaseBundleBuildOptions(input);

    return {
        ...options,
        projectRoot: resolve(cwd, options.projectRoot),
        outputDir: resolve(cwd, options.outputDir),
        cacheDir:
            options.cacheDir !== undefined
                ? resolve(cwd, options.cacheDir)
                : undefined,
    };
}
