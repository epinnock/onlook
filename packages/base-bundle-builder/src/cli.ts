import type { BaseBundlePlatform, CreateBaseBundleBuildOptionsInput } from './options';

export const BASE_BUNDLE_BUILD_COMMAND = 'base-bundle:build';

export interface BaseBundleCliParseResult extends CreateBaseBundleBuildOptionsInput {}

export function createBaseBundleCliHelpText(): string {
    return [
        `Usage: ${BASE_BUNDLE_BUILD_COMMAND} --project-root <path> --out <dir> [--platform ios|android] [--dev] [--no-minify] [--cache-dir <dir>]`,
        '',
        'Required:',
        '  --project-root <path>  Project root to bundle from',
        '  --out <dir>            Output directory for the bundle',
        '',
        'Optional:',
        '  --platform <value>     Target platform (ios or android). Default: ios',
        '  --dev                  Build in dev mode',
        '  --no-minify            Disable minification',
        '  --cache-dir <dir>      Metro cache directory',
    ].join('\n');
}

export function createBaseBundleCliErrorText(message: string): string {
    return [`base-bundle-builder: ${message}`, '', createBaseBundleCliHelpText()].join('\n');
}

export function parseBaseBundleCliArgs(
    argv: readonly string[],
): BaseBundleCliParseResult {
    const firstArg = argv[0];
    if (firstArg === undefined || isHelpArg(firstArg)) {
        throw new Error(createBaseBundleCliHelpText());
    }

    const [command, ...rest] = argv;
    if (command !== BASE_BUNDLE_BUILD_COMMAND) {
        throw new Error(
            createBaseBundleCliErrorText(
                `Unknown command "${command}". Expected "${BASE_BUNDLE_BUILD_COMMAND}".`,
            ),
        );
    }

    const options: BaseBundleCliParseState = {
        platform: 'ios',
        dev: false,
        minify: true,
    };

    for (let index = 0; index < rest.length; index += 1) {
        const arg = rest[index];
        if (arg === undefined) {
            continue;
        }

        if (arg === '--dev') {
            options.dev = true;
            continue;
        }

        if (arg === '--no-minify') {
            options.minify = false;
            continue;
        }

        if (arg === '--project-root' || arg === '--out' || arg === '--cache-dir' || arg === '--platform') {
            const value = rest[index + 1];
            if (value === undefined || value.startsWith('--')) {
                throw new Error(createBaseBundleCliErrorText(`Missing value for ${arg}.`));
            }

            index += 1;

            if (arg === '--project-root') {
                options.projectRoot = value;
            } else if (arg === '--out') {
                options.outputDir = value;
            } else if (arg === '--cache-dir') {
                options.cacheDir = value;
            } else {
                options.platform = parseBaseBundlePlatform(value);
            }

            continue;
        }

        if (arg.startsWith('--')) {
            throw new Error(createBaseBundleCliErrorText(`Unknown option "${arg}".`));
        }

        throw new Error(createBaseBundleCliErrorText(`Unexpected positional argument "${arg}".`));
    }

    if (options.projectRoot === undefined) {
        throw new Error(createBaseBundleCliErrorText('Missing required option --project-root.'));
    }

    if (options.outputDir === undefined) {
        throw new Error(createBaseBundleCliErrorText('Missing required option --out.'));
    }

    return {
        projectRoot: options.projectRoot,
        outputDir: options.outputDir,
        platform: options.platform,
        dev: options.dev,
        minify: options.minify,
        ...(options.cacheDir !== undefined ? { cacheDir: options.cacheDir } : {}),
    };
}

function parseBaseBundlePlatform(value: string): BaseBundlePlatform {
    if (value === 'ios' || value === 'android') {
        return value;
    }

    throw new Error(
        createBaseBundleCliErrorText(
            `Invalid platform "${value}". Expected "ios" or "android".`,
        ),
    );
}

function isHelpArg(arg: string): boolean {
    return arg === '-h' || arg === '--help';
}

interface BaseBundleCliParseState {
    platform?: BaseBundlePlatform;
    dev?: boolean;
    minify?: boolean;
    projectRoot?: string;
    outputDir?: string;
    cacheDir?: string;
}
