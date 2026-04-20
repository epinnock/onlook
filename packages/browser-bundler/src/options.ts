import { createExternalSpecifierSet } from './plugins/external';

export type BrowserBundlePlatform = 'ios' | 'android';

export interface BrowserBundleVirtualFile {
    readonly path: string;
    readonly contents: string;
}

export interface BrowserBundleOptions {
    readonly entryPoint: string;
    readonly files: readonly BrowserBundleVirtualFile[];
    readonly externalSpecifiers: ReadonlySet<string>;
    readonly platform: BrowserBundlePlatform;
    readonly minify: boolean;
    readonly sourcemap: boolean;
    readonly wasmUrl?: string | URL;
}

export interface CreateBrowserBundleOptionsInput {
    readonly entryPoint: string;
    readonly files: readonly BrowserBundleVirtualFile[];
    readonly externalSpecifiers: Iterable<string>;
    readonly platform?: BrowserBundlePlatform;
    readonly minify?: boolean;
    readonly sourcemap?: boolean;
    readonly wasmUrl?: string | URL;
}

export function createBrowserBundleOptions(
    input: CreateBrowserBundleOptionsInput,
): BrowserBundleOptions {
    assertNonEmptyPath(input.entryPoint, 'entryPoint');

    if (input.files.length === 0) {
        throw new Error('Browser bundle options require at least one virtual file');
    }

    for (const file of input.files) {
        assertNonEmptyPath(file.path, 'file.path');
    }

    return {
        entryPoint: normalizeVirtualPath(input.entryPoint),
        files: input.files.map((file) => ({
            ...file,
            path: normalizeVirtualPath(file.path),
        })),
        externalSpecifiers: createExternalSpecifierSet(input.externalSpecifiers),
        platform: input.platform ?? 'ios',
        minify: input.minify ?? false,
        sourcemap: input.sourcemap ?? true,
        wasmUrl: input.wasmUrl,
    };
}

export function normalizeVirtualPath(path: string): string {
    assertNonEmptyPath(path, 'path');
    return path.replace(/\\/g, '/').replace(/^\/+/, '/');
}

function assertNonEmptyPath(path: string, fieldName: string): void {
    if (path.trim().length === 0) {
        throw new Error(`Browser bundle option "${fieldName}" must be a non-empty path`);
    }
}
