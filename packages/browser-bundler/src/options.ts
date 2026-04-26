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
    /**
     * When true, every JSX opening tag in `.tsx`/`.jsx` source files gets a
     * `__source={ fileName, lineNumber, columnNumber }` prop injected via
     * `createJsxSourcePlugin`. Required for tap-to-source on the v1 overlay
     * path: `apps/mobile-client/src/inspector/tapHandler.ts` reads this
     * prop off the tapped element and dispatches an `onlook:select`
     * message that the editor's `wireOnlookSelectToIdeManager` resolves
     * to a CodeMirror cursor jump. Default false (esbuild's automatic
     * JSX runtime does NOT emit `__source`, unlike Babel's
     * `transform-react-jsx-source`).
     */
    readonly injectJsxSource: boolean;
}

export interface CreateBrowserBundleOptionsInput {
    readonly entryPoint: string;
    readonly files: readonly BrowserBundleVirtualFile[];
    readonly externalSpecifiers: Iterable<string>;
    readonly platform?: BrowserBundlePlatform;
    readonly minify?: boolean;
    readonly sourcemap?: boolean;
    readonly wasmUrl?: string | URL;
    /** See `BrowserBundleOptions.injectJsxSource`. Defaults to false. */
    readonly injectJsxSource?: boolean;
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
        injectJsxSource: input.injectJsxSource ?? false,
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
