import { transform } from 'sucrase';

import { buildInlineAssetModuleCode, isImageAssetPath } from './asset-loader';
import { REQUIRE_RE, SUPPORTED_BARE_IMPORTS } from './constants';
import { isBareSpecifier } from './path-utils';
import { resolveProjectSpecifier } from './resolution';
import {
    appendInlineSourceMap,
    createFallbackSourceMap,
    normalizeModuleSourceMap,
} from './source-map';
import { MobilePreviewBundleError } from './types';

export function buildModuleCode(
    filePath: string,
    source: string,
    files: Map<string, string>,
): string {
    if (isImageAssetPath(filePath)) {
        const code = buildInlineAssetModuleCode(source);
        return appendInlineSourceMap(
            code,
            createFallbackSourceMap(filePath, source),
        );
    }

    if (filePath.endsWith('.json')) {
        const code = [
            `module.exports = ${source.trim() || 'null'};`,
            'module.exports.default = module.exports;',
            'module.exports.__esModule = true;',
        ].join('\n');

        return appendInlineSourceMap(
            code,
            createFallbackSourceMap(filePath, source),
        );
    }

    try {
        const transformed = transform(source, {
            transforms: ['typescript', 'jsx', 'imports'],
            filePath,
            production: true,
            jsxRuntime: 'classic',
            sourceMapOptions: {
                compiledFilename: filePath,
            },
        });

        const code = transformed.code.replace(
            REQUIRE_RE,
            (_match, quote: string, specifier: string) => {
                const resolved = resolveProjectSpecifier(specifier, filePath, files);
                if (resolved != null) {
                    return `require(${quote}${resolved}${quote})`;
                }
                if (isBareSpecifier(specifier) && !SUPPORTED_BARE_IMPORTS.has(specifier)) {
                    throw new MobilePreviewBundleError(
                        `Unsupported package import "${specifier}" in ${filePath}.`,
                    );
                }
                return `require(${quote}${specifier}${quote})`;
            },
        );

        return appendInlineSourceMap(
            code,
            normalizeModuleSourceMap(filePath, source, transformed.sourceMap),
        );
    } catch (error) {
        throw new MobilePreviewBundleError(
            `Failed to transpile ${filePath}: ${error instanceof Error ? error.message : String(error)}`,
        );
    }
}
