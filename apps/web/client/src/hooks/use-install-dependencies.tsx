'use client';

/**
 * useInstallDependencies — single-hook composition of the Phase 9
 * #51 pipeline:
 *
 *   useInstallDependencies({ fileSystem, client })
 *     ↓
 *   usePackageJsonWatch(fileSystem, onDepChange)
 *     ↓ onDepChange(diff)
 *   installDependencies({ diff, client, onStatus })
 *     ↓
 *   status transitions exposed via React state
 *
 * One import, one hook call, ready for render. The layout-slot
 * decision that gates Task A also gates this — whoever lands the
 * render surface drops this in alongside `MobilePreviewDevPanelContainer`.
 *
 * **Status state machine:**
 *   idle → installing → ready → idle (on next diff) → installing → …
 *         |         → failed → idle (on user retry / next diff)
 *
 * **Abort handling:** returns a `cancel()` function that aborts any
 * in-flight install. Automatic: every new diff cancels the previous
 * install before starting a new one (rapid edits don't pile up
 * overlapping installs).
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { MobilePreviewVfs } from '@/services/mobile-preview';
import {
    installDependencies,
    type DependencyInstallStatus,
    type SandboxInstallClient,
} from '@/services/mobile-preview/dependency-install';
import {
    formatDependencyDiff,
    type DependencyField,
    type DependencyDiff,
} from '@/services/mobile-preview/package-json-diff';

import { usePackageJsonWatch } from './use-package-json-watch';

export interface UseInstallDependenciesOptions {
    readonly fileSystem: MobilePreviewVfs | null;
    readonly client: SandboxInstallClient | null;
    /** Package.json fields to diff. Defaults to dependencies only. */
    readonly fields?: ReadonlyArray<DependencyField>;
    /** Max retries per install. Forwarded to installDependencies. */
    readonly maxRetries?: number;
    /**
     * Fires after every diff detection, before the install runs.
     * Useful for logging or an intermediate toast ("Installing
     * lodash, zod…"). Receives the formatted summary string —
     * null-suppressed by the formatter when diff is empty, but this
     * hook already filters empty diffs via `usePackageJsonWatch`.
     */
    readonly onDiffDetected?: (summary: string) => void;
}

export interface UseInstallDependenciesResult {
    readonly status: DependencyInstallStatus;
    /**
     * Cancel any in-flight install. Safe to call even when idle —
     * no-op. The next diff detection re-arms the flow.
     */
    readonly cancel: () => void;
}

export function useInstallDependencies(
    options: UseInstallDependenciesOptions,
): UseInstallDependenciesResult {
    const {
        fileSystem,
        client,
        fields,
        maxRetries,
        onDiffDetected,
    } = options;
    const [status, setStatus] = useState<DependencyInstallStatus>({
        kind: 'idle',
    });

    // Hold the latest AbortController so `cancel` can stop an
    // in-flight install AND so a new diff cancels the previous.
    const controllerRef = useRef<AbortController | null>(null);
    const onDiffDetectedRef = useRef(onDiffDetected);
    onDiffDetectedRef.current = onDiffDetected;
    const clientRef = useRef(client);
    clientRef.current = client;
    const maxRetriesRef = useRef(maxRetries);
    maxRetriesRef.current = maxRetries;

    const handleDepChange = useCallback(
        async (diff: DependencyDiff) => {
            const currentClient = clientRef.current;
            if (!currentClient) {
                // No client wired — ignore the diff. The consumer
                // will get client nullability cleared on remount.
                return;
            }

            // Cancel any in-flight install before starting the next.
            // Rapid edits otherwise stack overlapping installs that
            // all race to reconcile the same lockfile.
            controllerRef.current?.abort();
            const controller = new AbortController();
            controllerRef.current = controller;

            const summary = formatDependencyDiff(diff);
            if (summary !== null) {
                try {
                    onDiffDetectedRef.current?.(summary);
                } catch {
                    // Consumer error must not affect the install
                    // flow.
                }
            }

            await installDependencies({
                diff,
                client: currentClient,
                maxRetries: maxRetriesRef.current,
                signal: controller.signal,
                onStatus: (s) => {
                    // Only surface the latest install's transitions.
                    // Previous-install transitions race with the
                    // AbortController but we double-check by ref.
                    if (controllerRef.current === controller) {
                        setStatus(s);
                    }
                },
            });
        },
        [],
    );

    usePackageJsonWatch(fileSystem, handleDepChange, fields ? { fields } : {});

    // Cleanup: abort on unmount.
    useEffect(() => {
        return () => {
            controllerRef.current?.abort();
            controllerRef.current = null;
        };
    }, []);

    const cancel = useCallback(() => {
        controllerRef.current?.abort();
    }, []);

    return { status, cancel };
}
