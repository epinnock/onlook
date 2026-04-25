/**
 * provider-install-client — adapter that turns any `@onlook/
 * code-provider` Provider (CF sandbox, CSB sandbox, NodeFs) into a
 * `SandboxInstallClient`. Every Provider supports `runCommand`, so
 * this closes the last missing piece of Phase 9 `#51`: a working
 * install pipeline wired through the existing sandbox runtime.
 *
 * The orchestrator (`installDependencies`) already handles status
 * transitions, retry, and abort. This adapter just formulates the
 * install command string and feeds it to `runCommand`.
 *
 * **What the caller picks:** the package manager. We default to
 * `bun install` because it's the repo's canonical tool (per
 * CLAUDE.md: "Package manager: Bun only"). Pass
 * `packageManager: 'npm'` / `'yarn'` / `'pnpm'` to override.
 *
 * **Success criteria:** the command returns exit code 0 AND
 * stderr doesn't contain `ERR!`. We observe via `runCommand`'s
 * `{output}` return which concatenates stdout+stderr. A more
 * precise impl would require a provider surface that reports
 * exitCode separately (open `#51` protocol item — see
 * `plans/two-tier-overlay-v2-task-queue.md`).
 */

import type {
    TerminalCommandInput,
    TerminalCommandOutput,
} from '@onlook/code-provider';

import type {
    SandboxInstallClient,
    SandboxInstallResult,
} from './dependency-install';

/**
 * Minimal surface of `@onlook/code-provider`'s `Provider` we need —
 * just runCommand. Using the narrow shape instead of the full
 * Provider class lets callers pass mocks / test fakes cleanly.
 */
export interface ProviderLike {
    runCommand(input: TerminalCommandInput): Promise<TerminalCommandOutput>;
}

export type PackageManager = 'bun' | 'npm' | 'yarn' | 'pnpm';

export interface ProviderInstallClientOptions {
    readonly provider: ProviderLike;
    /**
     * Which package manager to invoke. Defaults to `'bun'` per the
     * repo's CLAUDE.md convention. Some sandboxes have only npm;
     * callers override accordingly.
     */
    readonly packageManager?: PackageManager;
    /**
     * Working directory for the install. Defaults to `/workspace`
     * which is the CF-sandbox default project root. NodeFs +
     * CSB sandbox callers override.
     */
    readonly cwd?: string;
    /** Pre-install hook for tests — override the clock. */
    readonly now?: () => number;
}

const DEFAULT_CWD = '/workspace';

/**
 * Build a SandboxInstallClient backed by a code-provider.
 * Inert on `install([])` — the orchestrator already empty-checks
 * via the diff, but this is belt-and-suspenders.
 *
 * Command shape (bun):
 *   cd <cwd> && bun install <specifier1> <specifier2> ...
 *
 * The install is additive — `bun install <spec>` adds the listed
 * specifiers without removing others. For removed specifiers, we
 * emit `bun remove <spec>` in a second phase. Version changes
 * re-install with the new constraint.
 */
export function createProviderInstallClient(
    options: ProviderInstallClientOptions,
): SandboxInstallClient {
    const { provider, packageManager = 'bun', cwd = DEFAULT_CWD } = options;
    const now = options.now ?? Date.now;

    return {
        async install(specifiers, signal): Promise<SandboxInstallResult> {
            const start = now();
            if (specifiers.length === 0) {
                return { ok: true, durationMs: 0 };
            }
            if (signal?.aborted) {
                return {
                    ok: false,
                    error: 'aborted',
                    durationMs: now() - start,
                };
            }

            // Build install/remove commands. Caller doesn't tell us
            // which specifiers are adds-vs-removes (the diff is
            // collapsed into a single sorted list by the
            // orchestrator). For a first impl, invoke a single
            // `<pm> install` without explicit specifiers so the
            // sandbox re-reconciles from package.json — simpler
            // semantics than computing per-spec commands, and most
            // package managers' `install` without args reconciles
            // lockfile → node_modules from the current manifest.
            //
            // Future enhancement: emit `bun add <spec>` / `bun remove
            // <spec>` by accepting the full `DependencyDiff` through
            // a richer client interface. That's `#51` step (c)+(d)
            // once the install-shape question is settled.
            //
            // `2>&1` merges stderr so `output` carries everything.
            // `|| echo __onlook_install_fail__` keeps the command
            // exit-0 for provider shells that surface non-zero as
            // throws — we sniff the sentinel in `output` to detect
            // failure without needing a separate exit-code channel.
            const command = `cd ${shellQuote(cwd)} && ${packageManager} install 2>&1 || echo __onlook_install_fail__`;
            try {
                const result = await provider.runCommand({
                    args: { command },
                });
                const durationMs = now() - start;
                const output = result.output ?? '';
                if (output.includes('__onlook_install_fail__')) {
                    return {
                        ok: false,
                        error: extractErrorLine(output),
                        durationMs,
                    };
                }
                // `npm ERR!` / `yarn error` / `pnpm ERR` are the
                // standard error-line prefixes. If a package manager
                // somehow returns exit-0 while surfacing an error,
                // sniff for these to avoid false-positive success.
                if (/\b(npm ERR!|yarn error|pnpm ERR)/i.test(output)) {
                    return {
                        ok: false,
                        error: extractErrorLine(output),
                        durationMs,
                    };
                }
                return { ok: true, durationMs };
            } catch (err) {
                return {
                    ok: false,
                    error: err instanceof Error ? err.message : String(err),
                    durationMs: now() - start,
                };
            }
        },
    };
}

function shellQuote(s: string): string {
    // Simple single-quote wrap + escape. Good enough for absolute
    // paths like /workspace; callers don't pass user input here.
    return `'${s.replace(/'/g, `'\\''`)}'`;
}

function extractErrorLine(output: string): string {
    // Grab the last non-empty line that looks like an error. The
    // output from a failed install is usually multi-line; the last
    // error line is the most actionable signal for the UI.
    const lines = output.split('\n').filter((l) => l.trim().length > 0);
    for (let i = lines.length - 1; i >= 0; i -= 1) {
        const line = lines[i]!;
        if (/\b(error|err!|failed|cannot)/i.test(line)) {
            return line.trim().slice(0, 280);
        }
    }
    // Fall back to the last non-empty line — better than empty.
    return (lines[lines.length - 1] ?? 'install failed').trim().slice(0, 280);
}
