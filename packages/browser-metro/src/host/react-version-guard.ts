/**
 * Bundle-time React version guard for @onlook/browser-metro (MC6.4).
 *
 * The mobile-preview runtime (`packages/mobile-preview/runtime/bundle.js`)
 * ships with `react` 19.1.0 and `react-reconciler` 0.32.0 pinned. If a user's
 * bundle pulls in a different React version, silent bugs follow — the
 * reconciler relies on React's internals (ReactSharedInternals, fiber shape),
 * which change between minors. A minor/major mismatch between the runtime's
 * React and the bundle's React means the reconciler reaches for internals
 * that no longer exist and we crash or — worse — render incoherently.
 *
 * This guard runs at bundle time: the caller reads the project's
 * `package.json`, extracts `dependencies.react` + `dependencies.react-reconciler`,
 * and hands those strings to `checkReactVersions`. The guard compares them
 * against the pinned runtime versions and returns a result. Semver range
 * prefixes (`^`, `~`, `=`) are accepted so long as the **resolved floor**
 * still matches the pinned version exactly (major+minor).
 *
 * Rationale for the options-arg shape: Metro bundles do not embed
 * `package.json#version` strings reliably, so scanning bundle source for
 * version markers is brittle. Asking the caller to parse `package.json`
 * themselves keeps the guard deterministic and test-friendly.
 *
 * Deps: MCF7 (runtime version protocol). The pinned versions here are
 * independent of `ONLOOK_RUNTIME_VERSION` — that tracks the runtime's own
 * wire-protocol version, while this tracks the React library version the
 * runtime was built against.
 */

/** Pinned React version in `packages/mobile-preview/runtime/bundle.js`. */
export const REQUIRED_REACT_VERSION = '19.1.0';

/** Pinned react-reconciler version in `packages/mobile-preview/runtime/bundle.js`. */
export const REQUIRED_RECONCILER_VERSION = '0.32.0';

export interface ReactVersionDeps {
    react?: string;
    'react-reconciler'?: string;
}

export type ReactVersionCheckResult =
    | { ok: true }
    | { ok: false; errors: string[] };

interface ParsedVersion {
    major: number;
    minor: number;
    patch: number;
    /** The range operator the user wrote, if any. `''` means an exact pin. */
    operator: '' | '^' | '~' | '=';
}

/**
 * Minimal semver-range parser. Accepts `X.Y.Z`, `=X.Y.Z`, `^X.Y.Z`, `~X.Y.Z`.
 * Rejects multi-range strings (`>=1.0.0 <2.0.0`), pre-release tags (`1.0.0-rc`),
 * build metadata (`1.0.0+sha`), and wildcards (`1.x`). We intentionally keep
 * the grammar narrow — if the user's `package.json` carries something fancier
 * we want them to explain it to a human, not a regex.
 */
function parseVersionRange(raw: string): ParsedVersion | null {
    const trimmed = raw.trim();
    if (trimmed.length === 0) return null;

    let operator: ParsedVersion['operator'] = '';
    let rest = trimmed;
    if (rest.startsWith('^') || rest.startsWith('~') || rest.startsWith('=')) {
        operator = rest[0] as '^' | '~' | '=';
        rest = rest.slice(1).trim();
    }

    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(rest);
    if (!match) return null;
    const major = Number(match[1]);
    const minor = Number(match[2]);
    const patch = Number(match[3]);
    if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) {
        return null;
    }
    return { major, minor, patch, operator };
}

/**
 * Returns true iff `userRange` matches `requiredExact` on **major and minor**.
 * For `^` and `~` ranges we treat them as satisfied when the floor's major+minor
 * match the required version — stricter than npm's real semver but aligned with
 * our v1 policy of "patch can drift, minor/major cannot" (mirrors MCF7's
 * isCompatible()).
 *
 * Exact pins (`19.1.0` or `=19.1.0`) require an exact major+minor+patch match
 * to remove all ambiguity.
 */
function rangeMatches(userRange: string, requiredExact: string): boolean {
    const user = parseVersionRange(userRange);
    const required = parseVersionRange(requiredExact);
    if (!user || !required) return false;

    // Major must always match. Reconciler internals break across majors.
    if (user.major !== required.major) return false;
    if (user.minor !== required.minor) return false;

    // Exact pin: patch must also match. `^` / `~` allow patch drift.
    if (user.operator === '' || user.operator === '=') {
        return user.patch === required.patch;
    }

    return true;
}

/**
 * Bundle-time React version guard. Call before invoking BrowserMetro.bundle()
 * when a project `package.json` is available.
 *
 * @param deps - `{ react, 'react-reconciler' }` strings as they appear in the
 *   project's `package.json#dependencies` (or `devDependencies` — the caller
 *   decides which fields to read).
 * @returns `{ ok: true }` on match, or `{ ok: false, errors }` listing every
 *   mismatch found. Missing deps count as errors.
 */
export function checkReactVersions(deps: ReactVersionDeps): ReactVersionCheckResult {
    const errors: string[] = [];

    const reactDep = deps.react;
    if (!reactDep) {
        errors.push(
            `Missing 'react' dependency. @onlook/browser-metro requires react@${REQUIRED_REACT_VERSION} (pinned by the runtime bundle).`,
        );
    } else if (!rangeMatches(reactDep, REQUIRED_REACT_VERSION)) {
        errors.push(
            `react version mismatch: project has '${reactDep}', runtime requires '${REQUIRED_REACT_VERSION}'. The mobile-preview runtime pins React 19.1.0; a different major or minor will crash the reconciler.`,
        );
    }

    const reconcilerDep = deps['react-reconciler'];
    if (!reconcilerDep) {
        errors.push(
            `Missing 'react-reconciler' dependency. @onlook/browser-metro requires react-reconciler@${REQUIRED_RECONCILER_VERSION} (pinned by the runtime bundle).`,
        );
    } else if (!rangeMatches(reconcilerDep, REQUIRED_RECONCILER_VERSION)) {
        errors.push(
            `react-reconciler version mismatch: project has '${reconcilerDep}', runtime requires '${REQUIRED_RECONCILER_VERSION}'. Reconciler versions are paired with specific React minors; mixing them is undefined behaviour.`,
        );
    }

    if (errors.length > 0) {
        return { ok: false, errors };
    }
    return { ok: true };
}
