'use client';

/**
 * OverlayPreflightPanel — editor dev-panel surface for overlay preflight
 * issues (task #81 editor UI half).
 *
 * Consumes the `PreflightSummary` emitted by
 * `apps/web/client/src/services/expo-relay/preflight-formatter.ts` when
 * `preflightAbiV1Imports` reports unsupported-native or unknown-specifier
 * imports BEFORE the overlay bundle is sent to the relay. Rendering this
 * in-editor prevents the "edit → push → phone crashes → scroll log panel
 * → figure out the bare import was wrong" failure loop; the issue lands
 * in the editor panel with a clear suggestion while the user is still in
 * the edit.
 *
 * Design notes mirror the sibling dev-panel tabs (MobileConsoleTab,
 * MobileNetworkTab, MobileOverlayAckTab):
 *   - Raw tailwind primitives only (React 18 vs 19 pin issue).
 *   - Dark theme by default.
 *   - No state beyond what's in the summary prop — parent owns the
 *     lifecycle (summary = null → empty-state placeholder).
 */

import type { AbiV1PreflightIssue } from '@onlook/browser-bundler';
import { cn } from '@onlook/ui/utils';

import type { PreflightSummary } from '@/services/expo-relay/preflight-formatter';

const KIND_BADGE_CLS: Record<AbiV1PreflightIssue['kind'], string> = {
    'unsupported-native': 'bg-red-500/25 text-red-300 border-red-500/40',
    'unknown-specifier': 'bg-amber-500/25 text-amber-300 border-amber-500/40',
};

const KIND_LABEL: Record<AbiV1PreflightIssue['kind'], string> = {
    'unsupported-native': 'NATIVE',
    'unknown-specifier': 'UNKNOWN',
};

const KIND_DESCRIPTION: Record<AbiV1PreflightIssue['kind'], string> = {
    'unsupported-native':
        'This package needs native code. Overlays can only ship JS + assets — rebuild the base bundle / binary to include it.',
    'unknown-specifier':
        'This bare import is not in the base alias map. Either add it to the base bundle or switch to a pure-JS alternative.',
};

export interface OverlayPreflightPanelProps {
    /**
     * The PreflightSummary from `formatPreflightSummary(issues)`. Pass
     * `null` to render the empty-state placeholder (no issues to show).
     */
    summary: PreflightSummary | null;
    /** Optional className for the outer container. */
    className?: string;
}

export interface OverlayPreflightIssueRowProps {
    issue: AbiV1PreflightIssue;
}

export function OverlayPreflightIssueRow({ issue }: OverlayPreflightIssueRowProps) {
    return (
        <div
            data-testid="overlay-preflight-row"
            data-kind={issue.kind}
            className="flex items-start gap-2 border-b border-neutral-800/60 px-3 py-1.5 font-mono text-xs leading-relaxed hover:bg-neutral-800/40"
        >
            <span
                data-testid="overlay-preflight-kind"
                data-kind={issue.kind}
                className={cn(
                    'inline-flex h-4 shrink-0 items-center rounded-sm border px-1.5 text-[10px] font-semibold tracking-wide uppercase',
                    KIND_BADGE_CLS[issue.kind],
                )}
            >
                {KIND_LABEL[issue.kind]}
            </span>
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span
                    data-testid="overlay-preflight-specifier"
                    className="truncate font-semibold text-neutral-100"
                    title={issue.specifier}
                >
                    {issue.specifier}
                </span>
                <span
                    data-testid="overlay-preflight-file"
                    className="truncate text-neutral-500"
                    title={issue.filePath}
                >
                    {issue.filePath}
                </span>
            </div>
        </div>
    );
}

export function OverlayPreflightPanel({ summary, className }: OverlayPreflightPanelProps) {
    if (summary === null) {
        return (
            <div
                data-testid="overlay-preflight-empty"
                className={cn(
                    'flex h-full items-center justify-center px-3 py-8 text-xs text-neutral-500',
                    className,
                )}
            >
                No unsupported imports detected. Overlay will ship clean.
            </div>
        );
    }

    const { title, byKind } = summary;
    const native = byKind['unsupported-native'];
    const unknown = byKind['unknown-specifier'];

    return (
        <div
            data-testid="overlay-preflight-panel"
            className={cn(
                'flex h-full flex-col bg-neutral-950 text-neutral-100',
                className,
            )}
        >
            <header
                data-testid="overlay-preflight-title"
                className="sticky top-0 border-b border-neutral-800 bg-neutral-900/80 px-3 py-2 font-mono text-xs text-red-300 backdrop-blur"
            >
                <span className="font-semibold uppercase tracking-wide">
                    {title}
                </span>
                <span className="ml-2 tabular-nums text-neutral-500">
                    ({native.length + unknown.length} issue
                    {native.length + unknown.length === 1 ? '' : 's'})
                </span>
            </header>
            <div className="flex-1 overflow-y-auto">
                {native.length > 0 ? (
                    <section data-testid="overlay-preflight-section-native">
                        <div className="border-b border-neutral-800/80 bg-neutral-900/60 px-3 py-1 text-[11px] text-red-300">
                            {KIND_DESCRIPTION['unsupported-native']}
                        </div>
                        {native.map((issue, idx) => (
                            <OverlayPreflightIssueRow
                                key={`native-${issue.specifier}-${idx}`}
                                issue={issue}
                            />
                        ))}
                    </section>
                ) : null}
                {unknown.length > 0 ? (
                    <section data-testid="overlay-preflight-section-unknown">
                        <div className="border-b border-neutral-800/80 bg-neutral-900/60 px-3 py-1 text-[11px] text-amber-300">
                            {KIND_DESCRIPTION['unknown-specifier']}
                        </div>
                        {unknown.map((issue, idx) => (
                            <OverlayPreflightIssueRow
                                key={`unknown-${issue.specifier}-${idx}`}
                                issue={issue}
                            />
                        ))}
                    </section>
                ) : null}
            </div>
        </div>
    );
}
