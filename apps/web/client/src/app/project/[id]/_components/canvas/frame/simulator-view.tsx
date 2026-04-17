'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Icons } from '@onlook/ui/icons';
import { cn } from '@onlook/ui/utils';

import { api } from '@/trpc/react';
import {
    pointerToDeviceCoords,
    type IntrinsicSize,
} from '@/utils/canvas-to-device-coords';

/**
 * Live Spectra simulator frame. Renders the MJPEG stream at
 * `/api/spectra/mjpeg/<sessionId>` and forwards pointer interactions as
 * normalized tap/swipe calls through the `spectra` tRPC router.
 *
 * Expects the session to already exist (createSession is owned by
 * usePreviewInBrowser in Step 5). This view takes no responsibility for
 * lifecycle beyond its own DOM — teardown is the hook's job.
 */

const SWIPE_THRESHOLD_PX = 6;

interface SimulatorViewProps {
    sessionId: string;
    width: number;
    height: number;
    /** Optional — called when the <img> fails to load. */
    onStreamError?: () => void;
    className?: string;
}

type Status = 'connecting' | 'live' | 'error';

export function SimulatorView({
    sessionId,
    width,
    height,
    onStreamError,
    className,
}: SimulatorViewProps) {
    const [status, setStatus] = useState<Status>('connecting');
    const [attempt, setAttempt] = useState(0);
    const intrinsicRef = useRef<IntrinsicSize>({ width: 0, height: 0 });
    const containerRef = useRef<HTMLDivElement>(null);
    const pressRef = useRef<{ x: number; y: number } | null>(null);
    const [pulse, setPulse] = useState<{ x: number; y: number; key: number } | null>(null);

    const tapMutation = api.spectra.tap.useMutation();
    const swipeMutation = api.spectra.swipe.useMutation();

    const streamUrl = useMemo(
        () => `/api/spectra/mjpeg/${encodeURIComponent(sessionId)}?attempt=${attempt}`,
        [sessionId, attempt],
    );

    const handleLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
        const img = e.currentTarget;
        intrinsicRef.current = {
            width: img.naturalWidth,
            height: img.naturalHeight,
        };
        setStatus('live');
    }, []);

    const handleError = useCallback(() => {
        setStatus('error');
        onStreamError?.();
    }, [onStreamError]);

    const handleRetry = useCallback(() => {
        setStatus('connecting');
        setAttempt((n) => n + 1);
    }, []);

    const normalizeFromEvent = useCallback(
        (ev: React.PointerEvent<HTMLDivElement>) => {
            const container = containerRef.current;
            if (!container) return null;
            const rect = container.getBoundingClientRect();
            const offsetX = ev.clientX - rect.left;
            const offsetY = ev.clientY - rect.top;
            return pointerToDeviceCoords(
                { offsetX, offsetY },
                { width: rect.width, height: rect.height },
                intrinsicRef.current,
            );
        },
        [],
    );

    const handlePointerDown = useCallback(
        (ev: React.PointerEvent<HTMLDivElement>) => {
            if (status !== 'live') return;
            const p = normalizeFromEvent(ev);
            if (!p || p.outside) return;
            pressRef.current = { x: p.x, y: p.y };
            // Fire an optimistic pulse so the user sees feedback before the
            // next MJPEG frame arrives (100–300 ms of WDA roundtrip).
            const containerRect = containerRef.current?.getBoundingClientRect();
            if (containerRect) {
                setPulse({
                    x: ev.clientX - containerRect.left,
                    y: ev.clientY - containerRect.top,
                    key: Date.now(),
                });
            }
            (ev.target as Element).setPointerCapture?.(ev.pointerId);
        },
        [status, normalizeFromEvent],
    );

    const handlePointerUp = useCallback(
        (ev: React.PointerEvent<HTMLDivElement>) => {
            const start = pressRef.current;
            pressRef.current = null;
            if (!start) return;
            const end = normalizeFromEvent(ev);
            if (!end) return;

            // Compare in container pixels — the threshold is a UX choice
            // and shouldn't depend on device resolution.
            const container = containerRef.current;
            if (!container) return;
            const rect = container.getBoundingClientRect();
            const dxPx = Math.abs((end.x - start.x) * rect.width);
            const dyPx = Math.abs((end.y - start.y) * rect.height);

            if (dxPx < SWIPE_THRESHOLD_PX && dyPx < SWIPE_THRESHOLD_PX) {
                tapMutation.mutate({ sessionId, x: start.x, y: start.y });
            } else {
                swipeMutation.mutate({
                    sessionId,
                    x1: start.x,
                    y1: start.y,
                    x2: end.x,
                    y2: end.y,
                });
            }
        },
        [sessionId, tapMutation, swipeMutation, normalizeFromEvent],
    );

    useEffect(() => {
        if (!pulse) return;
        const t = setTimeout(() => setPulse(null), 350);
        return () => clearTimeout(t);
    }, [pulse]);

    return (
        <div
            ref={containerRef}
            className={cn(
                'relative overflow-hidden rounded-md bg-black select-none',
                className,
            )}
            style={{ width, height }}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
        >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
                key={attempt}
                src={streamUrl}
                alt="Simulator preview"
                onLoad={handleLoad}
                onError={handleError}
                className="pointer-events-none h-full w-full object-contain"
                draggable={false}
            />

            {status === 'connecting' && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background/90 text-foreground-secondary">
                    <Icons.LoadingSpinner className="h-6 w-6 animate-spin" />
                    <span className="text-xs">Connecting to simulator…</span>
                </div>
            )}

            {status === 'error' && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-background/90 text-foreground-secondary">
                    <span className="text-xs">Stream lost</span>
                    <button
                        type="button"
                        onClick={handleRetry}
                        className="rounded-md bg-foreground/10 px-3 py-1 text-xs text-foreground hover:bg-foreground/20"
                    >
                        Reconnect
                    </button>
                </div>
            )}

            {status === 'live' && (
                <div className="pointer-events-none absolute right-2 top-2 flex items-center gap-1.5 rounded-full bg-background/70 px-2 py-1 backdrop-blur-sm">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
                    <span className="text-[10px] font-medium uppercase tracking-wider text-foreground-secondary">
                        Live
                    </span>
                </div>
            )}

            {pulse && (
                <span
                    key={pulse.key}
                    className="pointer-events-none absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 animate-ping rounded-full border-2 border-white/70"
                    style={{ left: pulse.x, top: pulse.y }}
                />
            )}
        </div>
    );
}
