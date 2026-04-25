/**
 * dependency-install — orchestrates a package install in the
 * sandbox once a dependency diff has been detected. Phase 9 `#51`
 * step (b) foundation: decouples the install orchestration from the
 * actual sandbox protocol by taking a `SandboxInstallClient`
 * interface, which any future caller (CF sandbox, CSB sandbox,
 * local dev shell) can implement.
 *
 * **What this module owns:**
 * - Translating a `DependencyDiff` into the single install command
 *   the sandbox should run.
 * - Status-machine transitions: `idle → installing → ready | failed`.
 * - Retry policy (bounded — single retry on transient failure).
 * - Not throwing on install failure; surfacing via the status
 *   callback so the editor UI can render an error toast / retry CTA.
 *
 * **What this module DOES NOT own:**
 * - The actual sandbox protocol (what HTTP endpoint / TurboModule /
 *   shell call invokes `bun install`). That's up to the
 *   `SandboxInstallClient` implementation a caller provides.
 * - Caching / artifact warming — `#51` step (c), layered on top.
 * - UI rendering — `#51` step (d), consumes this orchestrator.
 */

import {
    isDependencyDiffEmpty,
    listChangedSpecifiers,
    type DependencyDiff,
} from './package-json-diff';

/**
 * The contract every sandbox-install backend must implement. One
 * method: take a list of specifiers (added + changed + removed
 * merged into the set of things the sandbox needs to reconcile) and
 * return a success / failure result.
 *
 * Implementations are expected to resolve with `{ok: false, error}`
 * on failure rather than throwing — the orchestrator swallows
 * throws defensively but implementations that use the structured
 * result get cleaner error messages in the UI.
 */
export interface SandboxInstallClient {
    /**
     * Install/update dependencies in the sandbox. `specifiers` is a
     * sorted array (matches `listChangedSpecifiers(diff)` output) so
     * implementations that generate deterministic cache keys can.
     * `signal` should be honored for cancellation — users edit
     * rapidly and stale installs should be abandoned.
     */
    install(
        specifiers: readonly string[],
        signal?: AbortSignal,
    ): Promise<SandboxInstallResult>;
}

export type SandboxInstallResult =
    | { readonly ok: true; readonly durationMs: number }
    | { readonly ok: false; readonly error: string; readonly durationMs: number };

export type DependencyInstallStatus =
    | { readonly kind: 'idle' }
    | { readonly kind: 'installing'; readonly specifiers: readonly string[] }
    | {
          readonly kind: 'ready';
          readonly specifiers: readonly string[];
          readonly durationMs: number;
          readonly retryCount: number;
      }
    | {
          readonly kind: 'failed';
          readonly specifiers: readonly string[];
          readonly error: string;
          readonly durationMs: number;
          readonly retryCount: number;
      };

export interface InstallDependenciesOptions {
    readonly diff: DependencyDiff;
    readonly client: SandboxInstallClient;
    /** Status-transition callback — called on every state change. */
    readonly onStatus?: (status: DependencyInstallStatus) => void;
    /** Abort signal — cancels any in-flight install. */
    readonly signal?: AbortSignal;
    /**
     * Max retries on transient failure. Default 1 (one retry). Set
     * to 0 to disable. Caller can implement exponential backoff by
     * composing retries of this function, but one transient retry
     * covers the common case of a flaky network.
     */
    readonly maxRetries?: number;
}

/**
 * Orchestrate a dependency install given a diff + sandbox client.
 * Returns the final status; ALSO fires `onStatus` on every
 * transition so a React consumer can reactively render the state
 * machine.
 *
 * **Empty diff short-circuit:** returns `{kind: 'idle'}` without
 * calling the client. The pure-helper layer (`isDependencyDiffEmpty`)
 * makes this cheap enough that callers can invoke unconditionally.
 *
 * **Cancellation:** checks `signal.aborted` before + after the
 * client call. Aborted installs resolve with a `failed` status
 * whose error is `'aborted'` so the status machine has a clean
 * terminal state.
 */
export async function installDependencies(
    options: InstallDependenciesOptions,
): Promise<DependencyInstallStatus> {
    const { diff, client, onStatus, signal } = options;
    const maxRetries = options.maxRetries ?? 1;

    if (isDependencyDiffEmpty(diff)) {
        const status: DependencyInstallStatus = { kind: 'idle' };
        onStatus?.(status);
        return status;
    }

    if (signal?.aborted) {
        return emit(onStatus, {
            kind: 'failed',
            specifiers: listChangedSpecifiers(diff),
            error: 'aborted',
            durationMs: 0,
            retryCount: 0,
        });
    }

    const specifiers = listChangedSpecifiers(diff);
    emit(onStatus, { kind: 'installing', specifiers });

    let attempt = 0;
    let lastError = '';
    let totalDurationMs = 0;
    while (attempt <= maxRetries) {
        if (signal?.aborted) {
            return emit(onStatus, {
                kind: 'failed',
                specifiers,
                error: 'aborted',
                durationMs: totalDurationMs,
                retryCount: attempt,
            });
        }
        let result: SandboxInstallResult;
        try {
            result = await client.install(specifiers, signal);
        } catch (err) {
            result = {
                ok: false,
                error: err instanceof Error ? err.message : String(err),
                durationMs: 0,
            };
        }
        totalDurationMs += result.durationMs;
        if (result.ok) {
            return emit(onStatus, {
                kind: 'ready',
                specifiers,
                durationMs: totalDurationMs,
                retryCount: attempt,
            });
        }
        lastError = result.error;
        attempt += 1;
    }

    return emit(onStatus, {
        kind: 'failed',
        specifiers,
        error: lastError,
        durationMs: totalDurationMs,
        retryCount: maxRetries,
    });
}

function emit(
    onStatus: ((s: DependencyInstallStatus) => void) | undefined,
    status: DependencyInstallStatus,
): DependencyInstallStatus {
    try {
        onStatus?.(status);
    } catch {
        // Status consumers must not affect the install outcome;
        // swallow consumer throws.
    }
    return status;
}
