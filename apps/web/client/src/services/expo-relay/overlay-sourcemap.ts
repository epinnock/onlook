/**
 * Overlay source-map fetcher + minimal frame resolver — task #86.
 *
 * ABI v1 overlays carry `OverlayMeta.sourceMapUrl` pointing at an R2-hosted
 * v3 source map. When a phone reports a runtime error with raw frames, the
 * editor calls `fetchOverlaySourceMap(url)` once per overlay hash and then
 * `resolveOverlayFrame(map, lineNumber, columnNumber)` per frame.
 *
 * We intentionally avoid taking a `source-map` npm dependency here — the
 * lockfile is gated. Instead we expose the raw RawSourceMap and a frame
 * resolver that handles the common case: an exact (line, column) mapping.
 * For complex scenarios (mapping ranges, names, chained maps) callers can
 * still pass the raw map through to a `source-map` consumer they construct
 * themselves.
 */
import type { OnlookRuntimeError } from '@onlook/mobile-client-protocol';

export interface RawSourceMap {
    readonly version: 3;
    readonly sources: readonly string[];
    readonly names: readonly string[];
    readonly mappings: string;
    readonly file?: string;
    readonly sourceRoot?: string;
    readonly sourcesContent?: readonly (string | null)[];
}

export interface OverlayFrameResolution {
    readonly fileName: string;
    readonly lineNumber: number;
    readonly columnNumber: number;
    readonly name?: string;
}

export interface FetchOverlaySourceMapOptions {
    readonly url: string;
    readonly fetchImpl?: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    readonly timeoutMs?: number;
}

export async function fetchOverlaySourceMap(
    options: FetchOverlaySourceMapOptions,
): Promise<RawSourceMap | null> {
    const fetchImpl = options.fetchImpl ?? globalThis.fetch;
    if (typeof fetchImpl !== 'function') return null;

    const controller = new AbortController();
    const timer = setTimeout(
        () => controller.abort(),
        options.timeoutMs ?? 5000,
    );
    try {
        const resp = await fetchImpl(options.url, { signal: controller.signal });
        if (!resp.ok) return null;
        const parsed = (await resp.json()) as unknown;
        if (!isRawSourceMap(parsed)) return null;
        return parsed;
    } catch {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

function isRawSourceMap(value: unknown): value is RawSourceMap {
    if (typeof value !== 'object' || value === null) return false;
    const v = value as Record<string, unknown>;
    return (
        v.version === 3 &&
        Array.isArray(v.sources) &&
        typeof v.mappings === 'string' &&
        Array.isArray(v.names)
    );
}

/**
 * Decode a compact VLQ segment from the v3 mappings string. Exported for
 * tests — callers normally just use `resolveOverlayFrame`.
 */
export function decodeVlqSegment(input: string): readonly number[] {
    const BASE64: Record<string, number> = {};
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
    for (let i = 0; i < chars.length; i += 1) BASE64[chars[i]!] = i;

    const out: number[] = [];
    let value = 0;
    let shift = 0;
    for (const ch of input) {
        const digit = BASE64[ch];
        if (digit === undefined) break;
        const cont = digit & 32;
        const raw = digit & 31;
        value |= raw << shift;
        if (cont) {
            shift += 5;
        } else {
            const negative = value & 1;
            value >>= 1;
            out.push(negative ? (value === 0 ? -2147483648 : -value) : value);
            value = 0;
            shift = 0;
        }
    }
    return out;
}

/**
 * Resolve an overlay-local (line, column) pair to the original source
 * location. Line is 1-based (matches OnlookRuntimeError.source convention);
 * internal mappings are 0-based.
 *
 * Returns null if no mapping exists at (or before) the point.
 */
export function resolveOverlayFrame(
    map: RawSourceMap,
    lineNumber: number,
    columnNumber: number,
): OverlayFrameResolution | null {
    const lines = map.mappings.split(';');
    const targetLine0 = lineNumber - 1;
    if (targetLine0 < 0 || targetLine0 >= lines.length) return null;

    // Walk up to and including target line, keeping the running deltas.
    let sourceIndex = 0;
    let sourceLine = 0;
    let sourceColumn = 0;
    let nameIndex = 0;
    let best: OverlayFrameResolution | null = null;

    for (let lineIdx = 0; lineIdx <= targetLine0; lineIdx += 1) {
        const line = lines[lineIdx] ?? '';
        if (line.length === 0) continue;
        let genColumn = 0;
        for (const segment of line.split(',')) {
            if (segment.length === 0) continue;
            const fields = decodeVlqSegment(segment);
            genColumn += fields[0] ?? 0;
            if (fields.length >= 4) {
                sourceIndex += fields[1]!;
                sourceLine += fields[2]!;
                sourceColumn += fields[3]!;
                if (fields.length >= 5) {
                    nameIndex += fields[4]!;
                }
                if (lineIdx === targetLine0 && genColumn <= columnNumber) {
                    best = {
                        fileName: map.sources[sourceIndex] ?? '<unknown>',
                        lineNumber: sourceLine + 1,
                        columnNumber: sourceColumn,
                        ...(fields.length >= 5 && map.names[nameIndex]
                            ? { name: map.names[nameIndex] }
                            : {}),
                    };
                }
            }
        }
    }
    return best;
}

/**
 * Decorate an OnlookRuntimeError with original-source `source` by resolving
 * its `stack` frames through the fetched map. Returns a new error; the input
 * is not mutated. If no source location can be derived, returns the input
 * unchanged.
 */
export function decorateRuntimeErrorWithSourceMap(
    error: OnlookRuntimeError,
    map: RawSourceMap | null,
): OnlookRuntimeError {
    if (map === null || !error.stack) return error;
    // Very simple extraction: `at name (file:L:C)` or `file:L:C` — we only
    // look at the first frame for v1.
    const match = /([A-Za-z0-9_<>./\\-]+):(\d+):(\d+)/.exec(error.stack);
    if (!match) return error;
    const line = Number(match[2]);
    const column = Number(match[3]);
    const resolved = resolveOverlayFrame(map, line, column);
    if (!resolved) return error;
    return { ...error, source: resolved };
}
