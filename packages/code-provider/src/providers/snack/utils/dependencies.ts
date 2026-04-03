/**
 * Snack dependency management utilities.
 *
 * Provides helpers for reading, writing, merging, and removing dependencies
 * on a Snack SDK instance.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SnackDep {
    version: string;
}

export interface SnackInstance {
    updateDependencies(deps: Record<string, SnackDep | null>): void;
    getState(): { dependencies: Record<string, SnackDep> };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Parse the `dependencies` (and optionally `devDependencies`) fields of a
 * raw `package.json` string into a flat `Record<string, SnackDep>`.
 *
 * Invalid JSON causes an empty record to be returned.
 */
export function parsePackageJsonDeps(packageJsonContent: string): Record<string, SnackDep> {
    let parsed: Record<string, unknown>;
    try {
        parsed = JSON.parse(packageJsonContent);
    } catch {
        return {};
    }

    const result: Record<string, SnackDep> = {};

    const sections: Array<'dependencies' | 'devDependencies'> = [
        'dependencies',
        'devDependencies',
    ];

    for (const section of sections) {
        const deps = parsed[section];
        if (deps && typeof deps === 'object' && !Array.isArray(deps)) {
            for (const [name, version] of Object.entries(deps as Record<string, unknown>)) {
                if (typeof version === 'string') {
                    result[name] = { version };
                }
            }
        }
    }

    return result;
}

/**
 * Add or update dependencies on a Snack instance.
 *
 * `deps` is a simple `name -> version` map. Each entry is converted to the
 * `SnackDep` shape before being forwarded to `snack.updateDependencies`.
 */
export function updateSnackDeps(snack: SnackInstance, deps: Record<string, string>): void {
    const snackDeps: Record<string, SnackDep> = {};
    for (const [name, version] of Object.entries(deps)) {
        snackDeps[name] = { version };
    }
    snack.updateDependencies(snackDeps);
}

/**
 * Remove a single dependency from a Snack instance by setting it to `null`.
 */
export function removeSnackDep(snack: SnackInstance, name: string): void {
    snack.updateDependencies({ [name]: null });
}

/**
 * Return a simplified `name -> version` map from a Snack state's
 * `dependencies` record.
 */
export function getSnackDeps(state: { dependencies: Record<string, SnackDep> }): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [name, dep] of Object.entries(state.dependencies)) {
        result[name] = dep.version;
    }
    return result;
}

/**
 * Merge `incoming` (`name -> version`) into an `existing` `SnackDep` map.
 *
 * Incoming entries overwrite existing ones when the name matches; entries
 * only present in `existing` are preserved.
 */
export function mergeDeps(
    existing: Record<string, SnackDep>,
    incoming: Record<string, string>,
): Record<string, SnackDep> {
    const result: Record<string, SnackDep> = { ...existing };
    for (const [name, version] of Object.entries(incoming)) {
        result[name] = { version };
    }
    return result;
}
