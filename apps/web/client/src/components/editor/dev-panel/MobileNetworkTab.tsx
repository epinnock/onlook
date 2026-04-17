'use client';

/**
 * MobileNetworkTab (MC5.17).
 *
 * Editor-side dev-panel component that renders the network stream
 * forwarded by the Onlook Mobile Client (MC5.5) over the relay
 * WebSocket. Mirrors the shape + conventions of `MobileConsoleTab`
 * (MC5.16) — same props, same WS-filter-then-render pipeline, same
 * `@onlook/ui`-light styling so it survives the React 18/19 pinning
 * mismatch that QrModalBody (TQ3.1) documented.
 *
 * Design notes:
 *   - The wire protocol (`NetworkMessageSchema` in
 *     `@onlook/mobile-client-protocol`) emits one message per request
 *     *phase* (`start` / `end` / `error`), all carrying the same
 *     `requestId`. We fold them into a single row-per-request view:
 *     the latest phase for a given `requestId` wins, so a request
 *     that progresses `start → end` shows up as a single row that
 *     "resolves" in place once the response lands. Request order is
 *     preserved via the first-seen insertion index — newer requests
 *     append to the bottom.
 *   - Status cells colour-code by class (2xx green, 4xx amber, 5xx
 *     red) so glancing at a dozen rows tells you where the failures
 *     are. Pending rows (no status yet, or `phase === 'error'` with
 *     no HTTP status) render in neutral.
 *   - Row click toggles a details panel directly underneath that row
 *     showing everything the protocol carries: request id, phase,
 *     timestamp, duration, and the raw URL (useful for long URLs
 *     that get truncated in the table). The protocol does not
 *     currently carry request/response headers — when it does (see
 *     Wave 6 follow-up), the shape of the details panel will pick
 *     them up without a table-level change.
 *   - The details panel uses a `useState`-backed `selectedId`, with
 *     the toggle semantics factored out into `computeNextSelected`
 *     so unit tests can exercise the state machine without a DOM.
 */

import { useMemo, useState } from 'react';

import {
    type NetworkMessage,
    type WsMessage,
} from '@onlook/mobile-client-protocol';
import { cn } from '@onlook/ui/utils';

export interface MobileNetworkTabProps {
    /**
     * Raw WS message stream. The component filters to `onlook:network`
     * entries internally — callers can hand over the full unfiltered
     * buffer without narrowing the type.
     */
    messages: WsMessage[];
    /**
     * Optional filter: only render entries for this session. Omit to
     * render every session in the stream.
     */
    sessionId?: string;
    /** Optional class for the outer scroll container. */
    className?: string;
}

/**
 * Fold the raw phased stream into one row per `requestId`. The
 * *latest* phase for a given id wins (so a `start` gets replaced
 * once its `end` arrives), and rows retain the order in which they
 * were first seen — which matches the order the requests fired on
 * device.
 *
 * Exported for direct unit testing; also consumed by the component.
 */
export function filterNetworkMessages(
    messages: readonly WsMessage[],
    sessionId?: string,
): NetworkMessage[] {
    const byId = new Map<string, NetworkMessage>();
    const order: string[] = [];
    for (const m of messages) {
        if (m.type !== 'onlook:network') continue;
        if (sessionId && m.sessionId !== sessionId) continue;
        if (!byId.has(m.requestId)) order.push(m.requestId);
        byId.set(m.requestId, m);
    }
    return order.map((id) => byId.get(id)!);
}

/**
 * Map an HTTP status code (or `undefined` for pending) to a tailwind
 * colour class. 1xx/3xx land in neutral on purpose — they rarely
 * appear on mobile and making them pop would be visual noise.
 */
export function statusColorClass(status: number | undefined): string {
    if (status === undefined) return 'text-neutral-500';
    if (status >= 200 && status < 300) return 'text-green-500';
    if (status >= 400 && status < 500) return 'text-amber-500';
    if (status >= 500 && status < 600) return 'text-red-500';
    return 'text-neutral-500';
}

/**
 * Pure toggle reducer — exported so the row-click state machine can
 * be exercised without a DOM. Click a row to select; click the same
 * row again to deselect.
 */
export function computeNextSelected(
    current: string | null,
    clickedId: string,
): string | null {
    return current === clickedId ? null : clickedId;
}

function formatDuration(durationMs: number | undefined): string {
    if (durationMs === undefined) return '—';
    if (durationMs < 1) return '<1 ms';
    if (durationMs < 1000) return `${Math.round(durationMs)} ms`;
    return `${(durationMs / 1000).toFixed(2)} s`;
}

function formatTimestamp(ts: number): string {
    const d = new Date(ts);
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    const ss = String(d.getUTCSeconds()).padStart(2, '0');
    const ms = String(d.getUTCMilliseconds()).padStart(3, '0');
    return `${hh}:${mm}:${ss}.${ms}`;
}

export interface MobileNetworkRowProps {
    message: NetworkMessage;
    selected: boolean;
    onToggle: (requestId: string) => void;
}

/**
 * Exported separately so unit tests can render a single row
 * statically without mounting the scroll container.
 */
export function MobileNetworkRow({
    message,
    selected,
    onToggle,
}: MobileNetworkRowProps) {
    const statusCls = statusColorClass(message.status);
    const statusText =
        message.status !== undefined
            ? String(message.status)
            : message.phase === 'error'
              ? 'ERR'
              : 'pending';

    return (
        <>
            <button
                type="button"
                data-testid="mobile-network-row"
                data-request-id={message.requestId}
                data-selected={selected ? 'true' : 'false'}
                data-phase={message.phase}
                onClick={() => onToggle(message.requestId)}
                className={cn(
                    'grid w-full grid-cols-[4rem_1fr_5rem_5rem] items-center gap-2 border-b border-neutral-800/60 px-3 py-1.5 text-left font-mono text-xs hover:bg-neutral-800/40',
                    selected && 'bg-neutral-800/60',
                )}
            >
                <span
                    data-testid="mobile-network-method"
                    className="shrink-0 tracking-wide text-neutral-300 uppercase"
                >
                    {message.method}
                </span>
                <span
                    data-testid="mobile-network-url"
                    className="min-w-0 truncate text-neutral-100"
                    title={message.url}
                >
                    {message.url}
                </span>
                <span
                    data-testid="mobile-network-status"
                    data-status={message.status ?? ''}
                    className={cn('shrink-0 tabular-nums', statusCls)}
                >
                    {statusText}
                </span>
                <span
                    data-testid="mobile-network-duration"
                    className="shrink-0 tabular-nums text-neutral-400"
                >
                    {formatDuration(message.durationMs)}
                </span>
            </button>
            {selected ? (
                <div
                    data-testid="mobile-network-details"
                    data-request-id={message.requestId}
                    className="border-b border-neutral-800/60 bg-neutral-900/80 px-3 py-2 font-mono text-xs text-neutral-300"
                >
                    <dl className="grid grid-cols-[6rem_1fr] gap-x-3 gap-y-1">
                        <dt className="text-neutral-500">Request ID</dt>
                        <dd className="break-all text-neutral-200">
                            {message.requestId}
                        </dd>
                        <dt className="text-neutral-500">Method</dt>
                        <dd className="text-neutral-200">{message.method}</dd>
                        <dt className="text-neutral-500">URL</dt>
                        <dd className="break-all text-neutral-200">
                            {message.url}
                        </dd>
                        <dt className="text-neutral-500">Phase</dt>
                        <dd className="text-neutral-200">{message.phase}</dd>
                        <dt className="text-neutral-500">Status</dt>
                        <dd className={statusCls}>{statusText}</dd>
                        <dt className="text-neutral-500">Duration</dt>
                        <dd className="text-neutral-200">
                            {formatDuration(message.durationMs)}
                        </dd>
                        <dt className="text-neutral-500">Timestamp</dt>
                        <dd className="text-neutral-200">
                            {formatTimestamp(message.timestamp)}
                        </dd>
                    </dl>
                </div>
            ) : null}
        </>
    );
}

export function MobileNetworkTab({
    messages,
    sessionId,
    className,
}: MobileNetworkTabProps) {
    const entries = useMemo(
        () => filterNetworkMessages(messages, sessionId),
        [messages, sessionId],
    );

    const [selectedId, setSelectedId] = useState<string | null>(null);
    const onToggle = (id: string) =>
        setSelectedId((prev) => computeNextSelected(prev, id));

    if (entries.length === 0) {
        return (
            <div
                data-testid="mobile-network-empty"
                className={cn(
                    'flex h-full w-full items-center justify-center bg-neutral-950 text-sm text-neutral-500',
                    className,
                )}
            >
                No network activity
            </div>
        );
    }

    return (
        <div
            data-testid="mobile-network-scroll"
            className={cn(
                'h-full w-full overflow-y-auto bg-neutral-950 text-neutral-100',
                className,
            )}
        >
            <div
                data-testid="mobile-network-header"
                className="sticky top-0 z-10 grid grid-cols-[4rem_1fr_5rem_5rem] gap-2 border-b border-neutral-800 bg-neutral-900 px-3 py-1.5 font-mono text-[10px] font-semibold tracking-wide text-neutral-400 uppercase"
            >
                <span>Method</span>
                <span>URL</span>
                <span>Status</span>
                <span>Duration</span>
            </div>
            {entries.map((message) => (
                <MobileNetworkRow
                    key={message.requestId}
                    message={message}
                    selected={selectedId === message.requestId}
                    onToggle={onToggle}
                />
            ))}
        </div>
    );
}

export default MobileNetworkTab;
