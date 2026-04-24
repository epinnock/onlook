'use client';

/**
 * usePackageJsonWatch — watches the root package.json via a
 * MobilePreviewVfs watcher and fires `onDepChange(diff)` ONLY when
 * the `dependencies` field actually changed between revisions.
 *
 * Phase 9 `#51` scaffolding step (a+): unlocks the future
 * install-flow. The diff alone (`diffPackageDependencies`) is pure;
 * this hook adds the React lifecycle + Vfs watcher composition.
 * Callers still need to decide what to DO with the diff (sandbox
 * install, cache warming, status-bar update, etc.) — that's `#51`
 * step (b)/(c)/(d).
 *
 * **Design:**
 *   - Inert when `fileSystem` is null (safe to call unconditionally).
 *   - Reads the current `package.json` on mount, stores it in a ref.
 *     First-mount fires no callback — initial state is baseline.
 *   - On every 'update' event for path 'package.json', re-reads +
 *     diffs. If the diff isn't empty, fires the callback and
 *     updates the ref.
 *   - On unmount, unsubscribes the watcher.
 *   - `handlerRef` indirection so the effect body uses the latest
 *     onDepChange without re-subscribing on every render.
 *
 * **Not wired anywhere yet.** Ships as a composable primitive; the
 * future install-flow composes it with a sandbox-install invoker.
 */

import { useEffect, useRef } from 'react';

import type { MobilePreviewVfs } from '@/services/mobile-preview';
import {
    DEFAULT_DEPENDENCY_FIELDS,
    diffPackageDependencies,
    isDependencyDiffEmpty,
    type DependencyDiff,
    type DependencyField,
} from '@/services/mobile-preview/package-json-diff';

const PACKAGE_JSON_PATH = 'package.json';

export interface UsePackageJsonWatchOptions {
    /**
     * Which package.json fields to diff. Defaults to `['dependencies']`.
     * Pass `['dependencies', 'devDependencies']` to observe dev-dep
     * changes too.
     */
    readonly fields?: ReadonlyArray<DependencyField>;
}

/**
 * Watch the root `package.json` and fire `onDepChange(diff)` whenever
 * dependencies change. `fileSystem: null` makes the hook inert.
 */
export function usePackageJsonWatch(
    fileSystem: MobilePreviewVfs | null,
    onDepChange: (diff: DependencyDiff) => void,
    options: UsePackageJsonWatchOptions = {},
): void {
    const handlerRef = useRef(onDepChange);
    handlerRef.current = onDepChange;
    const lastContentRef = useRef<string | null>(null);

    useEffect(() => {
        if (!fileSystem) {
            lastContentRef.current = null;
            return;
        }

        let disposed = false;

        // Baseline read — first mount stores the content without
        // firing the callback. Diff-vs-baseline becomes the very
        // first callback the consumer sees.
        (async () => {
            try {
                const raw = await fileSystem.readFile(PACKAGE_JSON_PATH);
                if (disposed) return;
                lastContentRef.current =
                    typeof raw === 'string'
                        ? raw
                        : new TextDecoder().decode(raw);
            } catch {
                // File may not exist yet — that's fine. Treat as null
                // baseline; the first edit will appear as all-added.
                lastContentRef.current = null;
            }
        })();

        const fields =
            options.fields ?? DEFAULT_DEPENDENCY_FIELDS;

        // CodeFileSystem.watchDirectory throws synchronously before the
        // underlying provider session initializes. Guard so a pre-boot
        // render doesn't take down the editor tree.
        let unsubscribe: () => void;
        try {
            unsubscribe = fileSystem.watchDirectory('.', async (event) => {
            if (disposed) return;
            if (event.type !== 'create' && event.type !== 'update') return;
            // The watcher fires for every path in the tree; filter to
            // the root package.json (most Vfs implementations surface
            // leading './' or a raw relative path).
            if (
                event.path !== PACKAGE_JSON_PATH &&
                event.path !== `./${PACKAGE_JSON_PATH}` &&
                event.path !== `/${PACKAGE_JSON_PATH}`
            ) {
                return;
            }
            try {
                const raw = await fileSystem.readFile(PACKAGE_JSON_PATH);
                if (disposed) return;
                const nextContent =
                    typeof raw === 'string'
                        ? raw
                        : new TextDecoder().decode(raw);
                const diff = diffPackageDependencies(
                    lastContentRef.current,
                    nextContent,
                    fields,
                );
                if (!isDependencyDiffEmpty(diff)) {
                    try {
                        handlerRef.current(diff);
                    } catch {
                        // Consumer errors must not affect the watcher
                        // loop — swallow.
                    }
                }
                // Always advance the ref so the next diff is
                // relative to what we've observed (even when diff is
                // empty — could still be a whitespace / ordering
                // change we want to treat as the new baseline).
                lastContentRef.current = nextContent;
            } catch {
                // Read failure — treat as no-op. The next event will
                // re-try.
            }
        });
        } catch (err) {
            console.warn(
                '[package-json-watch] watchDirectory unavailable (fileSystem not initialized); ' +
                    'install pipeline will stay idle until the fileSystem boots.',
                err,
            );
            unsubscribe = () => undefined;
        }

        return () => {
            disposed = true;
            try {
                unsubscribe();
            } catch {
                /* ignore */
            }
        };
        // fields is read through a closure — a change during the
        // subscription lifetime is unusual (test-only); rely on
        // parent-component remount for that case.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [fileSystem]);
}
