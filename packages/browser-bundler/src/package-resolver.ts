/**
 * package.json field resolver — tasks #40, #41, #42 / Phase 5.
 *
 * React Native's Metro resolver picks the package entry in this field order:
 *   1. `react-native` (RN-specific entry — preferred when targeting the RN runtime)
 *   2. `exports` (modern subpath exports map)
 *   3. `module` (ES module entry for browser bundlers)
 *   4. `main` (CJS entry; the historical default)
 *
 * The `browser` field is deliberately NOT honored here — overlays target the
 * RN runtime, not the browser. Callers that want web resolution should use a
 * different helper (post-MVP).
 *
 * This resolver does NOT do I/O; it operates on a pre-parsed `PackageJson`
 * object.
 */

export interface PackageJson {
    readonly name?: string;
    readonly main?: string;
    readonly module?: string;
    readonly 'react-native'?: string | Readonly<Record<string, string>>;
    readonly browser?: string | Readonly<Record<string, string>>;
    readonly exports?: Readonly<Record<string, PackageExportsEntry>> | string;
    readonly [key: string]: unknown;
}

export type PackageExportsEntry = string | {
    readonly 'react-native'?: string;
    readonly import?: string;
    readonly require?: string;
    readonly default?: string;
    readonly node?: string;
};

export interface ResolvePackageEntryOptions {
    readonly pkg: PackageJson;
    /**
     * The specifier relative to the package. e.g. for `require("lodash/fp")`,
     * pass `"fp"`. For `require("lodash")`, pass `"."` or `""`.
     */
    readonly subpath?: string;
}

/**
 * Resolve a specifier against a package.json. Returns the string path to the
 * target module (relative to the package root) or null if no applicable field
 * is present.
 */
export function resolvePackageEntry(
    options: ResolvePackageEntryOptions,
): string | null {
    const subpath = (options.subpath ?? '').replace(/^\.\/?/, '');
    const isRoot = subpath === '' || subpath === '.';

    // 1. react-native field — can be string (root) or object (subpath map).
    const rnField = options.pkg['react-native'];
    if (rnField !== undefined) {
        if (typeof rnField === 'string' && isRoot) return normalize(rnField);
        if (typeof rnField === 'object' && rnField !== null) {
            const mapped = (rnField as Record<string, string>)[`./${subpath}`]
                ?? (rnField as Record<string, string>)[subpath];
            if (typeof mapped === 'string') return normalize(mapped);
        }
    }

    // 2. exports field — modern subpath exports map.
    const exportsField = options.pkg.exports;
    if (typeof exportsField === 'string' && isRoot) {
        return normalize(exportsField);
    }
    if (exportsField && typeof exportsField === 'object') {
        const key = isRoot ? '.' : `./${subpath}`;
        const entry = (exportsField as Record<string, PackageExportsEntry>)[key];
        if (entry !== undefined) {
            const resolved = resolveExportsEntry(entry);
            if (resolved !== null) return normalize(resolved);
        }
    }

    // 3. module — ES module entry.
    if (isRoot && typeof options.pkg.module === 'string') {
        return normalize(options.pkg.module);
    }

    // 4. main — CJS entry (historical default).
    if (isRoot && typeof options.pkg.main === 'string') {
        return normalize(options.pkg.main);
    }

    return null;
}

function resolveExportsEntry(entry: PackageExportsEntry): string | null {
    if (typeof entry === 'string') return entry;
    // Priority: react-native > import > default. We never pick `node` or
    // `browser` — those target different runtimes.
    return (
        entry['react-native'] ??
        entry.import ??
        entry.default ??
        entry.require ??
        null
    );
}

function normalize(path: string): string {
    return path.replace(/^\.\/?/, '');
}
