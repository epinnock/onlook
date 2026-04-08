/**
 * entry-resolver — picks the bundle entry file from a set of walked paths.
 *
 * Extracted from `host/index.ts` (Wave R2 / TR2.2). This module is
 * self-contained: it performs no I/O and imports nothing else from the
 * host package. Callers pass in the set of normalized paths their file
 * walker produced, and we return the first matching entry candidate.
 *
 * The default candidate order matters: the Expo SDK 54 fixture seeded
 * by TR0.2 ships an `index.ts` that registers `App` via AppRegistry, so
 * `index.tsx` / `index.ts` must be preferred over `App.tsx`. The legacy
 * `Object.keys(modules)[0]` fallback from the pre-R2 implementation is
 * intentionally dropped — entry resolution is now strict and throws
 * `NoEntryFoundError` when no candidate is present.
 */

export const DEFAULT_ENTRY_CANDIDATES: readonly string[] = [
    'index.tsx',
    'index.ts',
    'index.jsx',
    'index.js',
    'App.tsx',
    'App.jsx',
    'App.js',
    'src/App.tsx',
    'src/App.jsx',
    'src/index.tsx',
    'src/index.ts',
];

export interface EntryResolutionInput {
    /** Map of normalized file path → present (just check key existence). */
    paths: Set<string> | string[];
    /** Override the default candidates. */
    candidates?: readonly string[];
}

export class NoEntryFoundError extends Error {
    constructor(
        public readonly tried: readonly string[],
        public readonly available: readonly string[],
    ) {
        super(
            `No entry file found. Tried: ${tried.join(', ')}. Available: ${available
                .slice(0, 10)
                .join(', ')}${available.length > 10 ? `, +${available.length - 10} more` : ''}`,
        );
        this.name = 'NoEntryFoundError';
    }
}

/**
 * Pick the first existing entry file from a list of candidates.
 * Returns the matched path. Throws NoEntryFoundError if none match.
 *
 * Note: returns the string path, not the file content. Callers
 * use this path to look up content from their file walker output.
 */
export function resolveEntry(input: EntryResolutionInput): string {
    const candidates = input.candidates ?? DEFAULT_ENTRY_CANDIDATES;
    const pathSet = input.paths instanceof Set ? input.paths : new Set(input.paths);

    for (const candidate of candidates) {
        if (pathSet.has(candidate)) {
            return candidate;
        }
    }

    const available = Array.from(pathSet).sort();
    throw new NoEntryFoundError(candidates, available);
}
