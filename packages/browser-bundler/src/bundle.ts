import {
    createBrowserBundleOptions,
    type CreateBrowserBundleOptionsInput,
} from './options';
import { createExternalPlugin } from './plugins/external';
import { createVirtualFsLoadPlugin } from './plugins/virtual-fs-load';
import {
    createVirtualFsResolvePlugin,
    type VirtualFsFileMap,
} from './plugins/virtual-fs-resolve';

export interface BrowserBundlerOutputFile {
    readonly path: string;
    readonly text: string;
}

export interface BrowserBundlerBuildOptions {
    readonly entryPoints: readonly string[];
    readonly bundle: boolean;
    readonly format: 'cjs';
    readonly platform: 'browser';
    readonly write: false;
    readonly minify: boolean;
    readonly sourcemap: boolean;
    readonly plugins: readonly BrowserBundlerPlugin[];
}

export interface BrowserBundlerPlugin {
    readonly name: string;
    setup(build: unknown): void;
}

export interface BrowserBundlerBuildResult {
    readonly outputFiles?: readonly BrowserBundlerOutputFile[];
    readonly warnings?: readonly unknown[];
}

export interface BrowserBundlerEsbuildService {
    build(options: BrowserBundlerBuildOptions): Promise<BrowserBundlerBuildResult>;
}

export interface BundleBrowserProjectResult {
    readonly code: string;
    readonly sourceMap?: string;
    readonly warnings: readonly unknown[];
}

export async function bundleBrowserProject(
    input: CreateBrowserBundleOptionsInput,
    esbuild: BrowserBundlerEsbuildService,
): Promise<BundleBrowserProjectResult> {
    const options = createBrowserBundleOptions(input);
    const files = createVirtualFileMap(options.files);
    const result = await esbuild.build({
        entryPoints: [options.entryPoint],
        bundle: true,
        format: 'cjs',
        platform: 'browser',
        write: false,
        minify: options.minify,
        sourcemap: options.sourcemap,
        plugins: [
            createExternalPlugin({
                externalSpecifiers: options.externalSpecifiers,
            }) as BrowserBundlerPlugin,
            createVirtualFsResolvePlugin({ files }) as BrowserBundlerPlugin,
            createVirtualFsLoadPlugin({ files }) as BrowserBundlerPlugin,
        ],
    });

    const outputFiles = result.outputFiles ?? [];
    const codeFile = outputFiles.find((file) => file.path.endsWith('.js')) ?? outputFiles[0];
    const sourceMapFile = outputFiles.find((file) => file.path.endsWith('.map'));

    if (!codeFile || codeFile.text.trim().length === 0) {
        throw new Error('Browser bundler produced no JavaScript output');
    }

    return {
        code: codeFile.text,
        sourceMap: sourceMapFile?.text,
        warnings: result.warnings ?? [],
    };
}

function createVirtualFileMap(
    files: CreateBrowserBundleOptionsInput['files'],
): VirtualFsFileMap {
    return Object.fromEntries(files.map((file) => [file.path, file.contents]));
}
