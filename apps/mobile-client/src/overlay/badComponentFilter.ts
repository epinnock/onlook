/**
 * Predicate used by the subscribable `renderApp` in `index.js` to drop trees
 * that reference raw native component strings (`RCTRawText`, `RCTText`,
 * `RCTView`). Those identifiers only resolve when `packages/mobile-preview/
 * runtime/runtime.js`'s Fabric host-config is loaded — and on the Onlook
 * Mobile Client the mobile-preview runtime is intentionally skipped
 * (`globalThis.__noOnlookRuntime = true`), so evaluating them triggers
 * `Invariant Violation: View config getter callback for component 'RCTRawText'
 * must be a function (received undefined)`. See
 * `plans/adr/v2-pipeline-validation-findings.md` finding #4.
 *
 * Exported for unit testing (task #78). `index.js` has its own copy because
 * that file runs before the bundler sees any TypeScript — keep the two in
 * sync if either side changes.
 */

export const BAD_COMPONENTS: ReadonlySet<string> = new Set(['RCTRawText', 'RCTText', 'RCTView']);

type ElementLike = {
    type?: unknown;
    props?: { children?: unknown };
};

export function containsBadComponent(el: unknown): boolean {
    if (!el || typeof el !== 'object') return false;
    const e = el as ElementLike;
    if (typeof e.type === 'string' && BAD_COMPONENTS.has(e.type)) return true;
    const children = e.props?.children;
    if (!children) return false;
    if (Array.isArray(children)) {
        for (const child of children) {
            if (containsBadComponent(child)) return true;
        }
        return false;
    }
    return containsBadComponent(children);
}
