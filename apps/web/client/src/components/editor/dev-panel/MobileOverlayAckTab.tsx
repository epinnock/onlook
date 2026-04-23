'use client';

/**
 * MobileOverlayAckTab — editor-side dev-panel surface for overlay acks.
 *
 * Consumes the phone→editor `onlook:overlayAck` stream produced by
 * `apps/mobile-client/src/flow/twoTierBootstrap.ts`'s `sendAck` call on
 * mount (see commit 179743bf). The editor-side WebSocket ingestor
 * `RelayWsClient` (ed28a7fe) buffers them into an
 * `OverlayAckMessage[]` array exposed via `snapshot().acks` — this
 * component takes that buffer as a prop and renders each ack with
 * status badge + overlay hash + timestamp + (on failure) the error
 * kind/message.
 *
 * Design notes mirror MobileConsoleTab (MC5.16) to keep the dev panel
 * visually coherent:
 *   - Raw tailwind primitives, no `@onlook/ui/button` (React 18 vs 19
 *     pin mismatch — see MobileConsoleTab header for the rationale).
 *   - Dark theme by default.
 *   - Auto-scroll pins to the bottom on new entries; unpinned when the
 *     user scrolls up past a threshold, re-pinned on scroll-to-bottom.
 *   - Accepts either a flat ack array OR the full `WsMessage[]` stream
 *     so callers don't have to narrow the type before passing it in.
 *
 * MCG.10 closes when this lands in the actual editor panel layout —
 * that wiring belongs in whoever owns the dev-panel tab group and is
 * out of scope for this component. The component ships isolated and
 * unit-tested so it composes with the eventual parent.
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import type { OverlayAckMessage, WsMessage } from '@onlook/mobile-client-protocol';

import { EVAL_LATENCY_TARGET_MS } from '@/services/expo-relay/overlay-telemetry-sink';
import { cn } from '@onlook/ui/utils';

export interface MobileOverlayAckTabProps {
    /**
     * Ack entries to render. Either a pre-filtered `OverlayAckMessage[]`
     * or the full `WsMessage[]` / mixed stream — the component narrows
     * internally so callers can pass whatever they already have.
     */
    acks: ReadonlyArray<OverlayAckMessage | WsMessage>;
    /** Optional filter: only render acks for this sessionId. */
    sessionId?: string;
    /** Optional class for the outer scroll container. */
    className?: string;
}

const AUTO_SCROLL_THRESHOLD_PX = 16;

const STATUS_LABEL: Record<OverlayAckMessage['status'], string> = {
    mounted: 'MOUNTED',
    failed: 'FAILED',
};

const STATUS_BADGE_CLS: Record<OverlayAckMessage['status'], string> = {
    mounted: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    failed: 'bg-red-500/25 text-red-300 border-red-500/40',
};

const STATUS_ROW_CLS: Record<OverlayAckMessage['status'], string> = {
    mounted: 'text-neutral-200',
    failed: 'text-red-200',
};

function formatTimestamp(ts: number): string {
    const d = new Date(ts);
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    const ss = String(d.getUTCSeconds()).padStart(2, '0');
    const ms = String(d.getUTCMilliseconds()).padStart(3, '0');
    return `${hh}:${mm}:${ss}.${ms}`;
}

function shortHash(hash: string): string {
    if (hash.length <= 14) return hash;
    return `${hash.slice(0, 8)}…${hash.slice(-4)}`;
}

/**
 * Pure filter — exported for tests. Narrows a mixed WsMessage stream to
 * just the ack kind, optionally scoped to a sessionId.
 */
export function filterOverlayAcks(
    messages: ReadonlyArray<OverlayAckMessage | WsMessage>,
    sessionId?: string,
): OverlayAckMessage[] {
    const out: OverlayAckMessage[] = [];
    for (const m of messages) {
        if (m.type !== 'onlook:overlayAck') continue;
        if (sessionId && m.sessionId !== sessionId) continue;
        out.push(m as OverlayAckMessage);
    }
    return out;
}

export interface MobileOverlayAckRowProps {
    ack: OverlayAckMessage;
}

export function MobileOverlayAckRow({ ack }: MobileOverlayAckRowProps) {
    const errorLine =
        ack.status === 'failed' && ack.error
            ? `${ack.error.kind}: ${ack.error.message}`
            : null;
    return (
        <div
            data-testid="mobile-overlay-ack-row"
            data-status={ack.status}
            className="flex flex-col gap-0.5 border-b border-neutral-800/60 px-3 py-1.5 font-mono text-xs leading-relaxed hover:bg-neutral-800/40"
        >
            <div className="flex items-center gap-2">
                <span
                    data-testid="mobile-overlay-ack-timestamp"
                    className="shrink-0 tabular-nums text-neutral-500"
                >
                    {formatTimestamp(ack.timestamp)}
                </span>
                <span
                    data-testid="mobile-overlay-ack-status"
                    data-status={ack.status}
                    className={cn(
                        'inline-flex h-4 shrink-0 items-center rounded-sm border px-1.5 text-[10px] font-semibold tracking-wide uppercase',
                        STATUS_BADGE_CLS[ack.status],
                    )}
                >
                    {STATUS_LABEL[ack.status]}
                </span>
                <span
                    data-testid="mobile-overlay-ack-hash"
                    className={cn(
                        'min-w-0 truncate tabular-nums',
                        STATUS_ROW_CLS[ack.status],
                    )}
                    title={ack.overlayHash}
                >
                    {shortHash(ack.overlayHash)}
                </span>
                {(() => {
                    // Narrow through a local const — `Number.isFinite`
                    // doesn't currently narrow `number | undefined` to
                    // `number` in TS, so we capture into a typed var.
                    const dur = ack.mountDurationMs;
                    if (!Number.isFinite(dur)) return null;
                    const finiteDur = dur as number;
                    return (
                        <span
                            data-testid="mobile-overlay-ack-mount-duration"
                            className={cn(
                                'shrink-0 tabular-nums',
                                finiteDur > EVAL_LATENCY_TARGET_MS
                                    ? 'text-amber-400'
                                    : 'text-neutral-500',
                            )}
                            title={`Phone-side mountOverlay() latency. ADR-0001 target is ≤ ${EVAL_LATENCY_TARGET_MS}ms on a 2-year-old iPhone.`}
                        >
                            {Math.round(finiteDur)}ms
                        </span>
                    );
                })()}
                <span
                    data-testid="mobile-overlay-ack-session"
                    className="ml-auto shrink-0 text-neutral-600"
                >
                    {ack.sessionId}
                </span>
            </div>
            {errorLine !== null ? (
                <div
                    data-testid="mobile-overlay-ack-error"
                    className="pl-1 text-[11px] break-words whitespace-pre-wrap text-red-300"
                >
                    {errorLine}
                </div>
            ) : null}
        </div>
    );
}

/**
 * Aggregate stats over a filtered `OverlayAckMessage[]` for the
 * dev-panel summary footer and anyone else who wants a pure
 * computation (e.g. inline assertions in tests). Mirrors the
 * Phase 11b dashboard Q5b signal locally so devs without PostHog
 * access can still eyeball mount-latency behavior.
 *
 * Returns null for p95/mean fields when no ack in the set carries a
 * populated `mountDurationMs` — keeps the type clean instead of
 * returning 0 which would be misleading.
 */
export interface OverlayAckSummary {
    readonly count: number;
    readonly mountedCount: number;
    readonly failedCount: number;
    readonly meanMountDurationMs: number | null;
    readonly p95MountDurationMs: number | null;
    readonly overBudgetCount: number;
}

export function summarizeAcks(
    acks: ReadonlyArray<OverlayAckMessage>,
    opts: { evalLatencyTargetMs?: number } = {},
): OverlayAckSummary {
    const evalTarget = opts.evalLatencyTargetMs ?? EVAL_LATENCY_TARGET_MS;
    let mountedCount = 0;
    let failedCount = 0;
    let overBudgetCount = 0;
    const durations: number[] = [];
    for (const ack of acks) {
        if (ack.status === 'mounted') mountedCount += 1;
        else if (ack.status === 'failed') failedCount += 1;
        // `Number.isFinite` rejects NaN + ±Infinity — otherwise a single
        // ack with `mountDurationMs: Infinity` would poison the p95 + mean
        // aggregates for the whole summary. Schema already rejects these,
        // but `summarizeAcks` accepts an `OverlayAckMessage[]` which a
        // caller could construct without running through safeParse.
        if (Number.isFinite(ack.mountDurationMs)) {
            const d = ack.mountDurationMs as number;
            durations.push(d);
            if (d > evalTarget) overBudgetCount += 1;
        }
    }
    if (durations.length === 0) {
        return {
            count: acks.length,
            mountedCount,
            failedCount,
            meanMountDurationMs: null,
            p95MountDurationMs: null,
            overBudgetCount: 0,
        };
    }
    const mean =
        durations.reduce((a, b) => a + b, 0) / durations.length;
    // p95: ceil(n * 0.95) - 1 index in the sorted list (1-indexed p95 in
    // common statistical software). For small n this overshoots toward
    // the high end; that's fine for a dev-time summary.
    const sorted = [...durations].sort((a, b) => a - b);
    const p95Index = Math.min(
        sorted.length - 1,
        Math.ceil(sorted.length * 0.95) - 1,
    );
    const p95 = sorted[Math.max(0, p95Index)]!;
    return {
        count: acks.length,
        mountedCount,
        failedCount,
        meanMountDurationMs: mean,
        p95MountDurationMs: p95,
        overBudgetCount,
    };
}

export function MobileOverlayAckTab({
    acks,
    sessionId,
    className,
}: MobileOverlayAckTabProps) {
    const entries = useMemo(() => filterOverlayAcks(acks, sessionId), [acks, sessionId]);
    const summary = useMemo(() => summarizeAcks(entries), [entries]);

    const scrollRef = useRef<HTMLDivElement>(null);
    const [pinned, setPinned] = useState(true);

    useEffect(() => {
        if (!pinned) return;
        const el = scrollRef.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
    }, [entries, pinned]);

    const onScroll = (e: React.UIEvent<HTMLDivElement>): void => {
        const el = e.currentTarget;
        const distanceFromBottom = el.scrollHeight - (el.scrollTop + el.clientHeight);
        setPinned(distanceFromBottom <= AUTO_SCROLL_THRESHOLD_PX);
    };

    if (entries.length === 0) {
        return (
            <div
                data-testid="mobile-overlay-ack-empty"
                className={cn(
                    'flex h-full items-center justify-center px-3 py-8 text-xs text-neutral-500',
                    className,
                )}
            >
                No overlay mounts yet. Push one from the editor and watch for
                the ack here.
            </div>
        );
    }

    return (
        <div
            ref={scrollRef}
            onScroll={onScroll}
            data-testid="mobile-overlay-ack-tab"
            className={cn(
                'h-full overflow-y-auto bg-neutral-950 text-neutral-100',
                className,
            )}
        >
            <div
                data-testid="mobile-overlay-ack-summary"
                className="sticky top-0 z-10 flex items-center gap-2 border-b border-neutral-800/80 bg-neutral-950/95 px-3 py-1 font-mono text-[10px] text-neutral-400 backdrop-blur"
            >
                <span data-testid="mobile-overlay-ack-summary-count">
                    {summary.count} ack{summary.count === 1 ? '' : 's'}
                </span>
                <span className="text-neutral-600">·</span>
                <span
                    data-testid="mobile-overlay-ack-summary-mounted"
                    className="text-emerald-400"
                >
                    {summary.mountedCount} mounted
                </span>
                {summary.failedCount > 0 ? (
                    <>
                        <span className="text-neutral-600">·</span>
                        <span
                            data-testid="mobile-overlay-ack-summary-failed"
                            className="text-red-400"
                        >
                            {summary.failedCount} failed
                        </span>
                    </>
                ) : null}
                {summary.p95MountDurationMs !== null ? (
                    <>
                        <span className="text-neutral-600">·</span>
                        <span
                            data-testid="mobile-overlay-ack-summary-p95"
                            title={`p95 mountDurationMs across acks with the field populated. ADR-0001 target is ≤${EVAL_LATENCY_TARGET_MS}ms.`}
                            className={cn(
                                'tabular-nums',
                                summary.p95MountDurationMs > EVAL_LATENCY_TARGET_MS
                                    ? 'text-amber-400'
                                    : 'text-neutral-400',
                            )}
                        >
                            p95 {Math.round(summary.p95MountDurationMs)}ms
                        </span>
                    </>
                ) : null}
                {summary.overBudgetCount > 0 ? (
                    <>
                        <span className="text-neutral-600">·</span>
                        <span
                            data-testid="mobile-overlay-ack-summary-over-budget"
                            title={`Mounts that exceeded the ${EVAL_LATENCY_TARGET_MS}ms eval-latency budget.`}
                            className="text-amber-400"
                        >
                            {summary.overBudgetCount} over budget
                        </span>
                    </>
                ) : null}
            </div>
            {entries.map((ack, idx) => (
                <MobileOverlayAckRow key={`${ack.overlayHash}-${idx}`} ack={ack} />
            ))}
        </div>
    );
}
