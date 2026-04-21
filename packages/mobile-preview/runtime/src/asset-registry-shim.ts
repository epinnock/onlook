/**
 * Metro AssetRegistry compat shim — task #67 / Phase 7.
 *
 * RN libraries that accept `require("./icon.png")` in their type signatures
 * often call into `react-native/Libraries/Image/AssetRegistry` directly.
 * Metro populates that registry with entries of a specific shape:
 *
 *   {
 *     httpServerLocation: "/assets/src/images",
 *     width: 24,
 *     height: 24,
 *     scales: [1, 2, 3],
 *     hash: "abc123",
 *     name: "icon",
 *     type: "png"
 *   }
 *
 * Our `OverlayAssetManifest` uses a URI-centric descriptor. This module
 * translates between the two so overlays can ship AssetRegistry-compatible
 * entries when RN libraries require them.
 */

export interface MetroAssetRegistryEntry {
    readonly httpServerLocation: string;
    readonly width?: number;
    readonly height?: number;
    readonly scales: readonly number[];
    readonly hash: string;
    readonly name: string;
    readonly type: string;
}

/**
 * Translate an overlay asset URI + metadata to a Metro-compatible registry
 * entry. Filename is used to derive `name` + `type`; scales defaults to [1]
 * when not provided by the OverlayAssetManifest entry.
 */
export interface ToMetroAssetRegistryInput {
    /** sha256 hex of the asset bytes. */
    readonly hash: string;
    /** R2 URL. The shim parses out path + filename to populate `httpServerLocation` + `name`. */
    readonly uri: string;
    /** Asset kind from the overlay manifest — maps to the `type` field. */
    readonly mime: string;
    readonly width?: number;
    readonly height?: number;
    /** Explicit scale variant set (Metro populates this from @2x/@3x suffix detection). */
    readonly scales?: readonly number[];
}

export function toMetroAssetRegistryEntry(
    input: ToMetroAssetRegistryInput,
): MetroAssetRegistryEntry {
    const { name, type, location } = parseAssetUri(input.uri, input.mime);
    return {
        httpServerLocation: location,
        ...(input.width !== undefined ? { width: input.width } : {}),
        ...(input.height !== undefined ? { height: input.height } : {}),
        scales: input.scales ?? [1],
        hash: input.hash,
        name,
        type,
    };
}

function parseAssetUri(
    uri: string,
    mime: string,
): { name: string; type: string; location: string } {
    // Prefer the filename from the URI's path component. Fall back to mime
    // subtype when the URI has none (e.g. `data:` URIs).
    try {
        const parsed = new URL(uri);
        const path = parsed.pathname;
        const lastSlash = path.lastIndexOf('/');
        const filename = lastSlash >= 0 ? path.slice(lastSlash + 1) : path;
        const dotIdx = filename.lastIndexOf('.');
        const name = dotIdx > 0 ? filename.slice(0, dotIdx) : filename || 'asset';
        const typeFromFilename = dotIdx > 0 ? filename.slice(dotIdx + 1) : '';
        const type = typeFromFilename || mimeSubtype(mime);
        const location = lastSlash >= 0 ? path.slice(0, lastSlash) : '/';
        return { name, type, location };
    } catch {
        return { name: 'asset', type: mimeSubtype(mime), location: '/' };
    }
}

function mimeSubtype(mime: string): string {
    const idx = mime.indexOf('/');
    if (idx < 0) return 'bin';
    return mime.slice(idx + 1).split('+')[0] ?? 'bin';
}
