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

export function MobileOverlayAckTab({
    acks,
    sessionId,
    className,
}: MobileOverlayAckTabProps) {
    const entries = useMemo(() => filterOverlayAcks(acks, sessionId), [acks, sessionId]);

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
            {entries.map((ack, idx) => (
                <MobileOverlayAckRow key={`${ack.overlayHash}-${idx}`} ack={ack} />
            ))}
        </div>
    );
}
