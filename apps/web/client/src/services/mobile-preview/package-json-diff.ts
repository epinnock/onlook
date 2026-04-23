/**
 * package-json-diff — pure helper for detecting dependency changes
 * across package.json revisions. Foundation for Phase 9 task #51
 * (package install/update editor flow).
 *
 * The mobile-preview pipeline currently syncs `package.json` as a
 * regular source file (`two-tier.ts::shouldSyncPath` line 428), but
 * no caller inspects WHAT changed between revisions. A future
 * install-flow needs to: (a) observe a package.json edit, (b) diff
 * the dependencies, (c) trigger `bun install` in the sandbox for
 * the new/changed packages, (d) warm the browser-bundler's
 * pure-JS-cache before the next overlay build.
 *
 * This module ships step (b) — the pure diff — so the rest of the
 * pipeline can be assembled on top without blocking on sandbox
 * protocol design (step c is the primary open question in the v2
 * queue row #51).
 *
 * **No I/O.** Accepts plain JSON strings, returns a structured
 * `DependencyDiff`. Tolerates malformed input (returns empty diff).
 */

export type DependencyField =
    | 'dependencies'
    | 'devDependencies'
    | 'peerDependencies'
    | 'optionalDependencies';

export const DEFAULT_DEPENDENCY_FIELDS: ReadonlyArray<DependencyField> = [
    'dependencies',
];

export interface DependencyDiff {
    /** specifier → new version */
    readonly added: Readonly<Record<string, string>>;
    /** specifier → version that was present before */
    readonly removed: Readonly<Record<string, string>>;
    /** specifier → {from: old, to: new} for entries whose version changed */
    readonly changed: Readonly<
        Record<string, { readonly from: string; readonly to: string }>
    >;
    /** specifier → version that's identical across both revisions */
    readonly unchanged: Readonly<Record<string, string>>;
}

/** Returns true when there are no adds, removes, or version changes. */
export function isDependencyDiffEmpty(diff: DependencyDiff): boolean {
    return (
        Object.keys(diff.added).length === 0 &&
        Object.keys(diff.removed).length === 0 &&
        Object.keys(diff.changed).length === 0
    );
}

/**
 * List of specifiers that meaningfully changed between revisions —
 * the set a sandbox install would need to reconcile. `unchanged`
 * entries are excluded.
 */
export function listChangedSpecifiers(diff: DependencyDiff): string[] {
    const out: string[] = [];
    for (const k of Object.keys(diff.added)) out.push(k);
    for (const k of Object.keys(diff.removed)) out.push(k);
    for (const k of Object.keys(diff.changed)) out.push(k);
    out.sort();
    return out;
}

/**
 * Diff two package.json strings against a set of dependency fields.
 * Defaults to `dependencies` only — the common case for
 * install/update flows. Pass `fields` to include dev or peer deps.
 *
 * **Tolerates malformed JSON.** Either side being non-parseable,
 * non-object, or missing the field is treated as "empty deps on
 * that side", so the diff still yields a clean add/remove list
 * rather than throwing into the caller.
 *
 * **`prev` null/undefined** means "no prior revision" — every
 * dependency in `next` lands in `added`. Useful for the first-edit
 * case.
 */
export function diffPackageDependencies(
    prev: string | null | undefined,
    next: string,
    fields: ReadonlyArray<DependencyField> = DEFAULT_DEPENDENCY_FIELDS,
): DependencyDiff {
    const prevDeps = collectDeps(prev, fields);
    const nextDeps = collectDeps(next, fields);

    const added: Record<string, string> = {};
    const removed: Record<string, string> = {};
    const changed: Record<string, { from: string; to: string }> = {};
    const unchanged: Record<string, string> = {};

    for (const [spec, version] of Object.entries(nextDeps)) {
        if (!(spec in prevDeps)) {
            added[spec] = version;
        } else if (prevDeps[spec] !== version) {
            changed[spec] = { from: prevDeps[spec]!, to: version };
        } else {
            unchanged[spec] = version;
        }
    }
    for (const [spec, version] of Object.entries(prevDeps)) {
        if (!(spec in nextDeps)) {
            removed[spec] = version;
        }
    }

    return { added, removed, changed, unchanged };
}

function collectDeps(
    raw: string | null | undefined,
    fields: ReadonlyArray<DependencyField>,
): Record<string, string> {
    if (!raw) return {};
    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return {};
    }
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: Record<string, string> = {};
    for (const field of fields) {
        const section = (parsed as Record<string, unknown>)[field];
        if (typeof section !== 'object' || section === null) continue;
        for (const [spec, version] of Object.entries(section)) {
            // Last-writer-wins across fields — dev/peer overrides deps
            // when the SAME specifier appears in both, but that's a
            // pathological case (npm would warn). Keeping simple.
            if (typeof version !== 'string') continue;
            out[spec] = version;
        }
    }
    return out;
}
