'use client';

/**
 * MobileConsoleTab (MC5.16).
 *
 * Editor-side dev-panel component that renders the console stream
 * forwarded by the Onlook Mobile Client (MC5.1/MC5.2) over the relay
 * WebSocket. The caller passes in the raw `WsMessage[]` stream — this
 * component filters to `onlook:console` entries and renders them as a
 * scrollable, auto-pinned log panel.
 *
 * Design notes:
 *   - No editor-side WS context exists yet (the relay-ingest hook is
 *     slated for a later task in the queue). This component therefore
 *     takes messages as a plain prop so it composes with whatever ingest
 *     mechanism eventually lands (`WsMessage[]` flowing from a MobX
 *     store, a React context, or a tRPC subscription).
 *   - `@onlook/ui` pins React 18 in its devDependencies while the editor
 *     runs React 19. The existing `QrModalBody` (TQ3.1) avoids
 *     `@onlook/ui/button` for this reason. We follow the same pattern:
 *     raw tailwind utility classes for the visual primitives, and only
 *     reach for `@onlook/ui/badge` (which ships as a pure CVA function
 *     with no stateful hooks) for the level badge.
 *   - Dark theme by default — the editor's feature panels all run dark.
 *   - Auto-scroll pins to the bottom on new entries. If the user scrolls
 *     up past a small threshold, auto-scroll is paused until they scroll
 *     back to the bottom — this mirrors the behaviour of Chrome DevTools
 *     and the existing mobile `RecentLogsModal` (MC5.15).
 */

import { useEffect, useMemo, useRef, useState } from 'react';

import {
    type ConsoleLevel,
    type ConsoleMessage,
    type WsMessage,
} from '@onlook/mobile-client-protocol';
import { cn } from '@onlook/ui/utils';

export interface MobileConsoleTabProps {
    /**
     * Raw WS message stream. The component filters to `onlook:console`
     * entries internally so callers can hand over the full unfiltered
     * buffer without having to narrow the type.
     */
    messages: WsMessage[];
    /**
     * Optional filter: only render entries for this session. Omit to
     * render every session in the stream. Useful when the editor is
     * paired to a single QR preview.
     */
    sessionId?: string;
    /** Optional class for the outer scroll container. */
    className?: string;
}

/**
 * Pixel threshold within which the user is considered "at the bottom"
 * of the scroll area. A bit of slack keeps auto-scroll engaged across
 * sub-pixel rounding in Chromium/WebKit.
 */
const AUTO_SCROLL_THRESHOLD_PX = 16;

const LEVEL_LABEL: Record<ConsoleLevel, string> = {
    log: 'LOG',
    info: 'INFO',
    warn: 'WARN',
    error: 'ERR',
    debug: 'DBG',
};

/**
 * Level → badge tailwind classes. Colour choices mirror the mobile dev
 * menu `RecentLogsModal` (MC5.15) so a log line looks identical on the
 * phone and in the editor.
 */
const LEVEL_BADGE_CLS: Record<ConsoleLevel, string> = {
    log: 'bg-neutral-700 text-neutral-100 border-neutral-600',
    info: 'bg-blue-500/20 text-blue-400 border-blue-500/40',
    warn: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40',
    error: 'bg-red-500/25 text-red-400 border-red-500/40',
    debug: 'bg-neutral-500/20 text-neutral-300 border-neutral-500/40',
};

/**
 * Level → message text colour. The timestamp column stays dim; only
 * errors tint the message text so long log streams stay readable.
 */
const LEVEL_MESSAGE_CLS: Record<ConsoleLevel, string> = {
    log: 'text-neutral-100',
    info: 'text-neutral-100',
    warn: 'text-yellow-200',
    error: 'text-red-300',
    debug: 'text-neutral-400',
};

function formatTimestamp(ts: number): string {
    // Hermes sends `Date.now()` ms. We render `HH:MM:SS.mmm` in UTC so
    // it matches the mobile `RecentLogsModal` regardless of the
    // developer's laptop timezone vs the phone's.
    const d = new Date(ts);
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mm = String(d.getUTCMinutes()).padStart(2, '0');
    const ss = String(d.getUTCSeconds()).padStart(2, '0');
    const ms = String(d.getUTCMilliseconds()).padStart(3, '0');
    return `${hh}:${mm}:${ss}.${ms}`;
}

/**
 * The protocol pre-JSON-stringifies object args on the device so the
 * wire payload is stable (see `ConsoleMessageSchema`). We re-join with a
 * space on render to match browser DevTools' `console.log('a', {b:1})`
 * spacing convention.
 */
function formatArgs(args: readonly string[]): string {
    return args.join(' ');
}

/**
 * Pure filter — exported for tests. Keeps the component itself trivial
 * to unit-test without standing up a jsdom.
 */
export function filterConsoleMessages(
    messages: readonly WsMessage[],
    sessionId?: string,
): ConsoleMessage[] {
    const out: ConsoleMessage[] = [];
    for (const m of messages) {
        if (m.type !== 'onlook:console') continue;
        if (sessionId && m.sessionId !== sessionId) continue;
        out.push(m);
    }
    return out;
}

export interface MobileConsoleRowProps {
    message: ConsoleMessage;
}

/**
 * Exported separately so it can be rendered statically in unit tests
 * without mounting the scroll-container + effects.
 */
export function MobileConsoleRow({ message }: MobileConsoleRowProps) {
    return (
        <div
            data-testid="mobile-console-row"
            data-level={message.level}
            className="flex items-start gap-2 border-b border-neutral-800/60 px-3 py-1.5 font-mono text-xs leading-relaxed hover:bg-neutral-800/40"
        >
            <span
                data-testid="mobile-console-timestamp"
                className="shrink-0 tabular-nums text-neutral-500"
            >
                {formatTimestamp(message.timestamp)}
            </span>
            {/*
             * NOTE: intentionally a raw <span> rather than @onlook/ui/badge.
             * The badge component depends on @radix-ui/react-slot which
             * resolves against the React pinned in @onlook/ui's devDeps
             * (React 18) — the editor runs React 19, so reaching for
             * Badge here causes cross-version React child type errors in
             * SSR / unit tests (see QrModalBody for the same rationale).
             */}
            <span
                data-testid="mobile-console-level"
                data-level={message.level}
                className={cn(
                    'inline-flex h-4 shrink-0 items-center rounded-sm border px-1.5 text-[10px] font-semibold tracking-wide uppercase',
                    LEVEL_BADGE_CLS[message.level],
                )}
            >
                {LEVEL_LABEL[message.level]}
            </span>
            <span
                data-testid="mobile-console-message"
                className={cn(
                    'min-w-0 break-words whitespace-pre-wrap',
                    LEVEL_MESSAGE_CLS[message.level],
                )}
            >
                {formatArgs(message.args)}
            </span>
        </div>
    );
}

export function MobileConsoleTab({
    messages,
    sessionId,
    className,
}: MobileConsoleTabProps) {
    const entries = useMemo(
        () => filterConsoleMessages(messages, sessionId),
        [messages, sessionId],
    );

    const scrollRef = useRef<HTMLDivElement>(null);
    // Start pinned — if the user scrolls up we flip this off until they
    // scroll back down. `useState` (not a ref) so the effect below
    // re-reads the current value after renders.
    const [autoScroll, setAutoScroll] = useState(true);

    const onScroll = (e: React.UIEvent<HTMLDivElement>) => {
        const el = e.currentTarget;
        const distanceFromBottom =
            el.scrollHeight - el.scrollTop - el.clientHeight;
        setAutoScroll(distanceFromBottom <= AUTO_SCROLL_THRESHOLD_PX);
    };

    useEffect(() => {
        if (!autoScroll) return;
        const el = scrollRef.current;
        if (!el) return;
        el.scrollTop = el.scrollHeight;
    }, [entries.length, autoScroll]);

    if (entries.length === 0) {
        return (
            <div
                data-testid="mobile-console-empty"
                className={cn(
                    'flex h-full w-full items-center justify-center bg-neutral-950 text-sm text-neutral-500',
                    className,
                )}
            >
                No console output
            </div>
        );
    }

    return (
        <div
            ref={scrollRef}
            onScroll={onScroll}
            data-testid="mobile-console-scroll"
            className={cn(
                'h-full w-full overflow-y-auto bg-neutral-950 text-neutral-100',
                className,
            )}
        >
            {entries.map((message, idx) => (
                <MobileConsoleRow
                    // Timestamp collisions are possible under bursty logs
                    // (Hermes can fire multiple log() calls within the
                    // same ms tick), so pair it with the index to keep
                    // React keys unique.
                    key={`${message.timestamp}-${idx}`}
                    message={message}
                />
            ))}
        </div>
    );
}

export default MobileConsoleTab;
