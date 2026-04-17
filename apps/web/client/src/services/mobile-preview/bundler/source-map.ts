const INLINE_SOURCE_MAP_PREFIX =
    '//# sourceMappingURL=data:application/json;charset=utf-8;base64,';

export interface MobilePreviewSourceMap {
    version: 3;
    file: string;
    names: string[];
    sources: string[];
    sourcesContent?: string[];
    mappings: string;
    ignoreList?: number[];
}

interface RawSourceMapLike {
    file?: string;
    names?: string[];
    sources?: string[];
    sourcesContent?: string[];
    mappings?: string;
    ignoreList?: number[];
}

export function normalizeModuleSourceMap(
    filePath: string,
    source: string,
    sourceMap: RawSourceMapLike | undefined,
): MobilePreviewSourceMap {
    return {
        version: 3,
        file: sourceMap?.file ?? filePath,
        names: sourceMap?.names ?? [],
        sources:
            sourceMap?.sources != null && sourceMap.sources.length > 0
                ? sourceMap.sources
                : [filePath],
        sourcesContent:
            sourceMap?.sourcesContent != null &&
            sourceMap.sourcesContent.length > 0
                ? sourceMap.sourcesContent
                : [source],
        mappings: sourceMap?.mappings ?? '',
        ignoreList: sourceMap?.ignoreList,
    };
}

export function createFallbackSourceMap(
    filePath: string,
    source: string,
): MobilePreviewSourceMap {
    return {
        version: 3,
        file: filePath,
        names: [],
        sources: [filePath],
        sourcesContent: [source],
        mappings: '',
    };
}

export function appendInlineSourceMap(
    code: string,
    sourceMap: MobilePreviewSourceMap,
): string {
    return `${stripInlineSourceMap(code)}\n${INLINE_SOURCE_MAP_PREFIX}${encodeBase64(JSON.stringify(sourceMap))}`;
}

export function readInlineSourceMap(
    code: string,
): MobilePreviewSourceMap | null {
    const encoded = code.match(
        /\/\/# sourceMappingURL=data:application\/json(?:;charset=[^;]+)?;base64,([A-Za-z0-9+/=]+)\s*$/,
    )?.[1];
    if (encoded == null) {
        return null;
    }

    return JSON.parse(decodeBase64(encoded)) as MobilePreviewSourceMap;
}

function stripInlineSourceMap(code: string): string {
    return code.replace(
        /\n?\/\/# sourceMappingURL=data:application\/json(?:;charset=[^;]+)?;base64,[A-Za-z0-9+/=]+\s*$/,
        '',
    );
}

function encodeBase64(value: string): string {
    const bytes = new TextEncoder().encode(value);
    if (typeof globalThis.btoa === 'function') {
        let binary = '';
        for (const byte of bytes) {
            binary += String.fromCharCode(byte);
        }
        return globalThis.btoa(binary);
    }

    return Buffer.from(bytes).toString('base64');
}

function decodeBase64(value: string): string {
    if (typeof globalThis.atob === 'function') {
        const binary = globalThis.atob(value);
        const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
        return new TextDecoder().decode(bytes);
    }

    return Buffer.from(value, 'base64').toString('utf8');
}
