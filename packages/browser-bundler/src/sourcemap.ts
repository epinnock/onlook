export interface BrowserBundlerOutputFile {
    readonly path: string;
    readonly text: string;
}

export interface BrowserBundlerBuildResult {
    readonly outputFiles?: readonly BrowserBundlerOutputFile[];
}

export interface BrowserBundlerSourceMapObject {
    readonly [key: string]: unknown;
}

export type BrowserBundlerSourceMapInput =
    | string
    | BrowserBundlerSourceMapObject
    | undefined;

export function extractSourceMapText(
    outputFiles: readonly BrowserBundlerOutputFile[] | undefined,
): string | undefined {
    if (!outputFiles) {
        return undefined;
    }

    const sourceMapFile = outputFiles.find((file) => file.path.endsWith('.map'));
    return sourceMapFile?.text;
}

export function parseSourceMapText(
    sourceMapText: string | undefined,
): BrowserBundlerSourceMapObject | undefined {
    if (typeof sourceMapText !== 'string' || sourceMapText.trim().length === 0) {
        return undefined;
    }

    try {
        const parsed: unknown = JSON.parse(sourceMapText);
        return isSourceMapObject(parsed) ? parsed : undefined;
    } catch {
        return undefined;
    }
}

export function normalizeSourceMapText(
    sourceMap: BrowserBundlerSourceMapInput,
): string | undefined {
    if (typeof sourceMap === 'string') {
        return sourceMap;
    }

    if (isSourceMapObject(sourceMap)) {
        return JSON.stringify(sourceMap);
    }

    return undefined;
}

export function normalizeSourceMapObject(
    sourceMap: BrowserBundlerSourceMapInput,
): BrowserBundlerSourceMapObject | undefined {
    if (isSourceMapObject(sourceMap)) {
        return sourceMap;
    }

    if (typeof sourceMap === 'string') {
        return parseSourceMapText(sourceMap);
    }

    return undefined;
}

export function attachSourceMapToBundleResult<T extends object>(
    bundleResult: T,
    sourceMap: BrowserBundlerSourceMapInput,
): T & { readonly sourceMap?: string } {
    const normalizedSourceMap = normalizeSourceMapText(sourceMap);

    if (normalizedSourceMap === undefined) {
        return bundleResult as T & { readonly sourceMap?: string };
    }

    return {
        ...bundleResult,
        sourceMap: normalizedSourceMap,
    };
}

export function extractAndAttachSourceMap<T extends BrowserBundlerBuildResult & object>(
    bundleResult: T,
): T & { readonly sourceMap?: string } {
    return attachSourceMapToBundleResult(bundleResult, extractSourceMapText(bundleResult.outputFiles));
}

function isSourceMapObject(value: unknown): value is BrowserBundlerSourceMapObject {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
