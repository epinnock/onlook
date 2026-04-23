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

// ─── Registry installation (task #67) ────────────────────────────────────────

/**
 * Metro-compatible AssetRegistry. Mirrors the API surface
 * `@react-native/assets-registry/registry` ships:
 *
 *   registerAsset(asset) → id (1-based)
 *   getAssetByID(id)     → asset | undefined
 *
 * RN libraries that read assets via Metro's mechanism import that module and
 * expect those two methods. Our `installAssetRegistry()` exposes this same
 * shape so overlay code can `OnlookRuntime.require('@react-native/assets-registry/registry')`
 * (when the base bundle aliases it) and get a working registry.
 */
export interface MetroAssetRegistry {
    registerAsset(asset: MetroAssetRegistryEntry): number;
    getAssetByID(id: number): MetroAssetRegistryEntry | undefined;
    /** Number of assets registered (test helper). */
    readonly size: number;
}

export function createAssetRegistry(): MetroAssetRegistry {
    const assets: MetroAssetRegistryEntry[] = [];
    return {
        registerAsset(asset) {
            assets.push(asset);
            return assets.length; // 1-based id (Metro convention)
        },
        getAssetByID(id) {
            // Metro uses 1-based ids; index = id - 1.
            if (id < 1 || id > assets.length) return undefined;
            return assets[id - 1];
        },
        get size() {
            return assets.length;
        },
    };
}

/**
 * Pre-populate a fresh registry from an `OverlayAssetManifest`-like input.
 * Returns the registry plus a mapping from each manifest assetId to its
 * Metro-allocated id, so callers can rewrite `OnlookRuntime.resolveAsset`
 * stub modules to `getAssetByID(<numeric>)` references when they need to
 * interop with Metro-style consumers.
 */
export interface SeedAssetRegistryInput {
    /**
     * Map from overlay assetId (e.g. `image/<sha256>`) to a Metro-shape
     * registry entry. Caller produces the entries via `toMetroAssetRegistryEntry`.
     */
    readonly entries: Readonly<Record<string, MetroAssetRegistryEntry>>;
}

export interface SeededAssetRegistry {
    readonly registry: MetroAssetRegistry;
    readonly idByAssetId: Readonly<Record<string, number>>;
}

export function seedAssetRegistry(input: SeedAssetRegistryInput): SeededAssetRegistry {
    const registry = createAssetRegistry();
    const idByAssetId: Record<string, number> = {};
    // Iterate in insertion order — preserves overlay manifest ordering for
    // reproducible Metro ids across builds with the same manifest.
    for (const [assetId, entry] of Object.entries(input.entries)) {
        idByAssetId[assetId] = registry.registerAsset(entry);
    }
    return { registry, idByAssetId };
}

/**
 * Install the registry on a globalThis-like object so `OnlookRuntime.require`
 * can return it via the alias chain. Idempotent: re-installing replaces the
 * previous registry (overlay re-mount semantics).
 */
export interface AssetRegistryGlobals {
    __onlookAssetRegistry?: MetroAssetRegistry;
}

export function installAssetRegistry(
    globals: AssetRegistryGlobals,
    registry: MetroAssetRegistry,
): void {
    globals.__onlookAssetRegistry = registry;
}
