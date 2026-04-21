/**
 * Platform-aware file resolver — task #38 / two-tier-overlay-v2 Phase 5.
 *
 * Overlay authors frequently use platform-specific file suffixes (Metro
 * convention): `Button.ios.tsx` + `Button.android.tsx` + `Button.tsx`. When
 * the editor is building for the iOS base bundle, the resolver must prefer
 * `.ios.tsx` → `.native.tsx` → `.tsx` (in that order).
 *
 * This module is a pure helper — it doesn't do I/O. Callers pass a
 * `FileExistsFn` that the resolver consults per candidate path.
 */

export type Platform = 'ios' | 'android';

export interface ResolvePlatformExtOptions {
    /** File stem including directory, no extension. e.g. `/src/components/Button`. */
    readonly stem: string;
    /** Extensions to try (without the leading dot). Default: ['tsx', 'ts', 'jsx', 'js']. */
    readonly extensions?: readonly string[];
    /** Platform to prioritize. */
    readonly platform: Platform;
    /** Sync existence check — usually `(p) => fs.existsSync(p)` or a vfs lookup. */
    readonly fileExists: (path: string) => boolean;
}

const DEFAULT_EXTENSIONS: readonly string[] = ['tsx', 'ts', 'jsx', 'js'];

/**
 * Resolve `stem` to a concrete file path honoring platform-suffix priority.
 *
 * Order (for each extension in `extensions`):
 *   1. `stem.<platform>.<ext>`   (e.g. `Button.ios.tsx`)
 *   2. `stem.native.<ext>`       (RN convention)
 *   3. `stem.<ext>`              (generic fallback)
 *
 * Returns the first path for which `fileExists` returns true, or null if no
 * candidate exists.
 */
export function resolvePlatformExt(
    options: ResolvePlatformExtOptions,
): string | null {
    const extensions = options.extensions ?? DEFAULT_EXTENSIONS;
    for (const ext of extensions) {
        const candidates = [
            `${options.stem}.${options.platform}.${ext}`,
            `${options.stem}.native.${ext}`,
            `${options.stem}.${ext}`,
        ];
        for (const candidate of candidates) {
            if (options.fileExists(candidate)) {
                return candidate;
            }
        }
    }
    return null;
}

/**
 * Ordered list of candidate paths that `resolvePlatformExt` would check,
 * without performing any existence check. Useful for diagnostic logging or
 * cache warming.
 */
export function listPlatformResolverCandidates(
    options: Omit<ResolvePlatformExtOptions, 'fileExists'>,
): readonly string[] {
    const extensions = options.extensions ?? DEFAULT_EXTENSIONS;
    const candidates: string[] = [];
    for (const ext of extensions) {
        candidates.push(
            `${options.stem}.${options.platform}.${ext}`,
            `${options.stem}.native.${ext}`,
            `${options.stem}.${ext}`,
        );
    }
    return candidates;
}
