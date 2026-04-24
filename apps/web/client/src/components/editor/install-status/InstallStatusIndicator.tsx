'use client';

/**
 * InstallStatusIndicator — minimal renderable view of a
 * `DependencyInstallStatus`. Phase 9 `#51` step (d) — the UI piece
 * that closes the visible chain:
 *
 *   useInstallDependencies(…) → { status, cancel }
 *     ↓
 *   <InstallStatusIndicator status={status} onCancel={cancel} />
 *
 * Renders nothing when idle (no UI noise). On installing/ready/
 * failed, shows a single-line status pill with:
 *   - a colored dot (blue = installing, green = ready, red = failed)
 *   - the specifier-count or duration
 *   - a "Cancel" button when installing
 *   - a "Retry" button when failed (re-fires the last diff — caller
 *     wires the retry to their own state)
 *
 * **Zero dependencies on Radix / @onlook/ui.** Uses raw tailwind so
 * it can drop into any surface (terminal-area tab, top-bar badge,
 * standalone floating pill, etc.) without layout-library conflicts.
 * Keep visual coherence with MobileOverlayAckRow which uses the same
 * tailwind primitives.
 */
import { cn } from '@onlook/ui/utils';

import type { DependencyInstallStatus } from '@/services/mobile-preview/dependency-install';

export interface InstallStatusIndicatorProps {
    readonly status: DependencyInstallStatus;
    /** Called when user clicks "Cancel" during an installing state. */
    readonly onCancel?: () => void;
    /** Called when user clicks "Retry" after a failed install. */
    readonly onRetry?: () => void;
    readonly className?: string;
}

const DOT_CLS: Record<DependencyInstallStatus['kind'], string> = {
    idle: 'bg-neutral-500',
    installing: 'bg-blue-500 animate-pulse',
    ready: 'bg-emerald-500',
    failed: 'bg-red-500',
};

const LABEL: Record<DependencyInstallStatus['kind'], string> = {
    idle: 'idle',
    installing: 'Installing',
    ready: 'Installed',
    failed: 'Install failed',
};

export function InstallStatusIndicator({
    status,
    onCancel,
    onRetry,
    className,
}: InstallStatusIndicatorProps) {
    // Idle state renders nothing — no UI noise when there's nothing to show.
    if (status.kind === 'idle') return null;

    const specifierText =
        status.kind === 'installing' ||
        status.kind === 'ready' ||
        status.kind === 'failed'
            ? status.specifiers.length === 1
                ? status.specifiers[0]!
                : `${status.specifiers.length} packages`
            : null;

    return (
        <div
            data-testid="install-status-indicator"
            data-kind={status.kind}
            className={cn(
                'inline-flex items-center gap-2 rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1 font-mono text-xs text-neutral-200',
                className,
            )}
        >
            <span
                data-testid="install-status-dot"
                className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DOT_CLS[status.kind])}
            />
            <span data-testid="install-status-label" className="shrink-0">
                {LABEL[status.kind]}
                {specifierText ? `: ${specifierText}` : null}
            </span>
            {status.kind === 'ready' ? (
                <span
                    data-testid="install-status-duration"
                    className="shrink-0 tabular-nums text-neutral-500"
                >
                    {Math.round(status.durationMs)}ms
                </span>
            ) : null}
            {status.kind === 'failed' ? (
                <span
                    data-testid="install-status-error"
                    className="min-w-0 truncate text-red-300"
                    title={status.error}
                >
                    {status.error}
                </span>
            ) : null}
            {status.kind === 'installing' && onCancel ? (
                <button
                    data-testid="install-status-cancel"
                    type="button"
                    onClick={onCancel}
                    className="ml-1 shrink-0 rounded border border-neutral-700 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase text-neutral-300 hover:bg-neutral-800"
                >
                    Cancel
                </button>
            ) : null}
            {status.kind === 'failed' && onRetry ? (
                <button
                    data-testid="install-status-retry"
                    type="button"
                    onClick={onRetry}
                    className="ml-1 shrink-0 rounded border border-red-600/50 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase text-red-200 hover:bg-red-900/30"
                >
                    Retry
                </button>
            ) : null}
        </div>
    );
}
