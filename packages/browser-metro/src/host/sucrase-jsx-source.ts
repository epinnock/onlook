/**
 * Sucrase JSX → React.createElement transform with __source metadata.
 *
 * MC4.12 (Wave 4 — Onlook inspector).
 *
 * When bundling user code for the mobile preview, the editor needs every
 * React.createElement call to carry `__source: { fileName, lineNumber,
 * columnNumber }` so that an inspector tap on the device can be resolved
 * back to the exact source location in the editor.
 *
 * Sucrase's built-in dev transform already injects `__source` with
 * `fileName` and `lineNumber` (controlled by `production: false` +
 * `filePath`). This module wraps that transform and post-processes the
 * output to add `columnNumber` — computed from the original source by
 * matching each JSX open-tag `<` to its line/column position.
 */

import { transform } from 'sucrase';
import type { Transform } from 'sucrase';

export interface TransformJsxSourceOptions {
    /**
     * When true (the default), `__source` metadata is injected into every
     * React.createElement call. Set to `false` for production builds.
     */
    isDev?: boolean;
}

export interface TransformJsxSourceResult {
    /** Transformed JavaScript source. */
    code: string;
}

/**
 * Transform JSX to React.createElement calls. In development mode the
 * output includes `__source: { fileName, lineNumber, columnNumber }` on
 * every element so the Onlook inspector can map taps to source locations.
 *
 * @param code     - Source code containing JSX (may also contain TypeScript).
 * @param fileName - The file path embedded in `__source.fileName`.
 * @param options  - Optional. `isDev` defaults to `true`.
 * @returns The transformed source string (wrapped in a result object).
 */
export function transformWithJsxSource(
    code: string,
    fileName: string,
    options?: TransformJsxSourceOptions,
): TransformJsxSourceResult {
    const isDev = options?.isDev !== false;

    // Infer which Sucrase transforms to apply based on the file extension.
    const transforms: Transform[] = ['jsx'];
    if (
        fileName.endsWith('.ts') ||
        fileName.endsWith('.tsx')
    ) {
        transforms.push('typescript');
    }

    const result = transform(code, {
        transforms,
        jsxRuntime: 'classic',
        filePath: fileName,
        production: !isDev,
    });

    if (!isDev) {
        return { code: result.code };
    }

    // Sucrase emits __source with fileName + lineNumber but omits
    // columnNumber. Post-process to add it by scanning the original source
    // for JSX open-tag positions.
    const columnMap = buildJsxColumnMap(code);
    const enriched = injectColumnNumbers(result.code, columnMap);

    return { code: enriched };
}

/**
 * Build a map from lineNumber → array of 1-based column positions where
 * a JSX open-tag `<` appears on that line in the original source.
 *
 * We track every `<` that is followed by a letter or `/` (to skip
 * comparison operators like `a < b`). This is intentionally simple and
 * handles the common cases without a full parser.
 */
function buildJsxColumnMap(source: string): Map<number, number[]> {
    const map = new Map<number, number[]>();
    const lines = source.split('\n');

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        if (line === undefined) continue;
        const lineNumber = i + 1; // 1-based
        const columns: number[] = [];

        for (let col = 0; col < line.length; col++) {
            if (line[col] === '<') {
                const next = line[col + 1];
                // JSX tags start with <Letter or </ for closing tags.
                // Skip < used as comparison operator (followed by space,
                // digit, =, etc.).
                if (next !== undefined && (/[A-Za-z_]/.test(next) || next === '/')) {
                    columns.push(col + 1); // 1-based column
                }
            }
        }

        if (columns.length > 0) {
            map.set(lineNumber, columns);
        }
    }

    return map;
}

/**
 * Find every `__source: {fileName: _jsxFileName, lineNumber: N}` in the
 * Sucrase output and replace it with
 * `__source: {fileName: _jsxFileName, lineNumber: N, columnNumber: C}`.
 *
 * We consume columns from the map in order per line so that when multiple
 * JSX elements share a line, each gets the next available column.
 */
function injectColumnNumbers(
    transformed: string,
    columnMap: Map<number, number[]>,
): string {
    // Track consumption index per line.
    const consumed = new Map<number, number>();

    return transformed.replace(
        /(__source:\s*\{fileName:\s*_jsxFileName,\s*lineNumber:\s*)(\d+)(\s*\})/g,
        (_match, prefix: string, lineStr: string, suffix: string) => {
            const lineNumber = Number(lineStr);
            const columns = columnMap.get(lineNumber);

            if (columns === undefined || columns.length === 0) {
                // Fallback: no column info found, use column 1.
                return `${prefix}${lineStr}, columnNumber: 1${suffix}`;
            }

            const idx = consumed.get(lineNumber) ?? 0;
            const col = columns[idx] ?? 1;
            consumed.set(lineNumber, idx + 1);

            return `${prefix}${lineStr}, columnNumber: ${col}${suffix}`;
        },
    );
}
