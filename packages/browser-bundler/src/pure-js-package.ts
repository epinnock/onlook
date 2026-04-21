/**
 * Pure-JS package artifact format — task #47, Phase 6 starter.
 *
 * Pure-JS packages (lodash, zod, nanoid — anything without a native binary)
 * get prebuilt into artifacts that the editor's overlay bundler can merge
 * into a user overlay without running the full resolver + bundler on every
 * edit.
 *
 * An artifact is a frozen map of module paths → CJS factory functions, keyed
 * by the package's exact npm version. The runtime exposes a
 * `PureJsArtifactCache` that the editor queries before falling through to
 * esbuild bundling the package from source.
 */

export interface PureJsPackageArtifact {
    /** npm package name as it appears in import specifiers, e.g. "lodash". */
    readonly packageName: string;
    /** exact npm version, e.g. "4.17.21". */
    readonly version: string;
    /**
     * content-hash (sha256 hex of a deterministic serialization of `modules`).
     * Enables the editor to skip re-downloading known-good artifacts.
     */
    readonly artifactHash: string;
    /**
     * module-path → factory. Factories follow the CJS convention:
     * `(module, exports, require) => void` with side-effecting assigns to
     * `module.exports`.
     *
     * The overlay composer merges these into the overlay's own module
     * registry at numeric ids sequenced after the user's modules so local
     * user code resolves first on collision.
     */
    readonly modules: Readonly<Record<string, string>>;
    /**
     * entry module path (`require("lodash")` maps to this). Typically
     * `"index.js"` or whatever `main` points at.
     */
    readonly entry: string;
    /**
     * optional subpaths → module path for `require("lodash/fp/pick")`.
     * Matches the structure in `package.json#exports`.
     */
    readonly subpaths?: Readonly<Record<string, string>>;
}

export interface PureJsArtifactCache {
    get(packageName: string, version: string): Promise<PureJsPackageArtifact | null>;
    put(artifact: PureJsPackageArtifact): Promise<void>;
}

/**
 * In-memory cache — useful for tests and editor sessions that don't need
 * durability across reloads. Production caches are expected to be R2-backed
 * with content-hash keys.
 */
export function createInMemoryPureJsCache(): PureJsArtifactCache {
    const store = new Map<string, PureJsPackageArtifact>();
    const keyOf = (name: string, version: string) => `${name}@${version}`;
    return {
        async get(name, version) {
            return store.get(keyOf(name, version)) ?? null;
        },
        async put(artifact) {
            store.set(keyOf(artifact.packageName, artifact.version), artifact);
        },
    };
}

/**
 * Resolve a bare import against a pure-JS artifact. Returns the factory source
 * for the matching module, or null if the artifact doesn't cover it.
 *
 *   resolvePureJsModule(artifact, "lodash")        → artifact.modules[artifact.entry]
 *   resolvePureJsModule(artifact, "lodash/fp/pick") → artifact.modules[artifact.subpaths?.["fp/pick"]]
 */
export function resolvePureJsModule(
    artifact: PureJsPackageArtifact,
    specifier: string,
): string | null {
    if (specifier === artifact.packageName) {
        return artifact.modules[artifact.entry] ?? null;
    }
    const prefix = artifact.packageName + '/';
    if (!specifier.startsWith(prefix)) return null;
    const subpath = specifier.slice(prefix.length);
    const mapped = artifact.subpaths?.[subpath];
    if (mapped) return artifact.modules[mapped] ?? null;
    // Deep-path fallback — look for an exact module path match.
    return artifact.modules[subpath] ?? null;
}

/**
 * Merge an artifact's modules into an overlay's module registry. The overlay
 * is expected to carry a mutable `modules` map + a `moduleIdCounter` that
 * advances per insertion. Returns the base id the artifact's modules
 * occupy — the overlay's resolver uses this plus relative offsets.
 */
export interface OverlayModuleRegistry {
    readonly modules: Record<number, string>;
    moduleIdCounter: number;
}

export function mergePureJsArtifactIntoOverlay(
    overlay: OverlayModuleRegistry,
    artifact: PureJsPackageArtifact,
): { readonly baseId: number; readonly entryId: number } {
    const baseId = overlay.moduleIdCounter;
    const ids: Record<string, number> = {};
    for (const [path, factory] of Object.entries(artifact.modules)) {
        const id = overlay.moduleIdCounter;
        ids[path] = id;
        overlay.modules[id] = factory;
        overlay.moduleIdCounter += 1;
    }
    const entryId = ids[artifact.entry] ?? baseId;
    return { baseId, entryId };
}
