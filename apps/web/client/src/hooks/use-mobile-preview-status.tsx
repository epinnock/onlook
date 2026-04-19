'use client';

/**
 * useMobilePreviewStatus.
 *
 * Browser-only preview path: talks directly to the `mobile-preview` server
 * (`packages/mobile-preview/server/index.ts`). The server hashes the static
 * 241KB runtime bundle ONCE on startup and serves a manifest pointing at it,
 * so there is no per-click build pipeline. The hot loop for component edits
 * goes over the WebSocket eval channel on the same server (handled
 * elsewhere), not through manifest re-fetch.
 *
 * Replaces the old `usePreviewOnDevice` flow that was tarring the workspace
 * and driving cf-esm-builder through Metro+Hermes (~90s cold). That path is
 * the wrong architecture for the browser-only target — see
 * `plans/article-native-preview-from-browser.md`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { renderQrSvg } from '@/services/expo-relay';
import {
    buildMobilePreviewBundle,
    pushMobilePreviewUpdate,
    shouldSyncMobilePreviewPath,
    type MobilePreviewVfs,
} from '@/services/mobile-preview';

import type { QrModalStatus } from '@/components/ui/qr-modal';

export interface UseMobilePreviewStatusOptions {
    /**
     * Base URL of the mobile-preview HTTP server (typically port 8787).
     * Source from `env.NEXT_PUBLIC_MOBILE_PREVIEW_URL`. When empty, `open()`
     * lands in an error state with a clear message.
     */
    serverBaseUrl?: string;
    /**
     * Optional Vfs used to generate + push the live eval bundle once the
     * runtime QR is ready. When omitted, the hook only renders the QR flow.
     */
    fileSystem?: MobilePreviewVfs;
}

export interface UseMobilePreviewStatusResult {
    status: QrModalStatus;
    isOpen: boolean;
    /**
     * Number of devices currently connected to the mobile-preview WebSocket.
     * Polled while `serverBaseUrl` is configured — visible outside the QR
     * modal so the editor can show "N connected" on the preview button.
     * 0 when the poll hasn't completed a round yet or the server is down.
     */
    clientCount: number;
    open: () => Promise<void>;
    close: () => void;
    retry: () => Promise<void>;
}

interface MobilePreviewStatusResponse {
    runtimeHash: string | null;
    clients: number;
    manifestUrl: string | null;
}

export function useMobilePreviewStatus(
    opts: UseMobilePreviewStatusOptions,
): UseMobilePreviewStatusResult {
    const [status, setStatus] = useState<QrModalStatus>({ kind: 'idle' });
    const [isOpen, setIsOpen] = useState(false);
    const [clientCount, setClientCount] = useState(0);
    const didPushRef = useRef(false);

    const open = useCallback(async () => {
        setIsOpen(true);
        didPushRef.current = false;

        const baseUrl = opts.serverBaseUrl?.trim();
        if (!baseUrl) {
            setStatus({
                kind: 'error',
                message:
                    'Missing mobile preview server URL — set NEXT_PUBLIC_MOBILE_PREVIEW_URL.',
            });
            return;
        }

        setStatus({ kind: 'preparing' });

        try {
            const res = await fetch(`${baseUrl.replace(/\/$/, '')}/status`, {
                method: 'GET',
                cache: 'no-store',
            });
            if (!res.ok) {
                setStatus({
                    kind: 'error',
                    message: `mobile-preview /status returned ${res.status}`,
                });
                return;
            }
            const body = (await res.json()) as MobilePreviewStatusResponse;
            setClientCount(body.clients ?? 0);
            if (!body.manifestUrl) {
                setStatus({
                    kind: 'error',
                    message:
                        'mobile-preview server reachable but runtime not staged — restart the server.',
                });
                return;
            }

            const qrSvg = await renderQrSvg(body.manifestUrl);
            setStatus({ kind: 'ready', manifestUrl: body.manifestUrl, qrSvg });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setStatus({
                kind: 'error',
                message: `Failed to reach mobile-preview server: ${message}`,
            });
        }
    }, [opts.serverBaseUrl]);

    const close = useCallback(() => {
        setIsOpen(false);
        setStatus({ kind: 'idle' });
        didPushRef.current = false;
    }, []);

    const retry = useCallback(async () => {
        await open();
    }, [open]);

    // Poll /status for the live connected-device count. Runs whenever a
    // preview server URL is configured — independent of the QR modal
    // open/close state — so the editor can show "N connected" on the
    // phone icon / top-bar button even with the modal closed.
    useEffect(() => {
        const baseUrl = opts.serverBaseUrl?.trim();
        if (!baseUrl) {
            setClientCount(0);
            return;
        }

        let cancelled = false;
        const statusUrl = `${baseUrl.replace(/\/$/, '')}/status`;

        const tick = async () => {
            try {
                const res = await fetch(statusUrl, {
                    method: 'GET',
                    cache: 'no-store',
                });
                if (cancelled || !res.ok) return;
                const body = (await res.json()) as MobilePreviewStatusResponse;
                if (cancelled) return;
                setClientCount(body.clients ?? 0);
            } catch {
                // Transient network errors are expected (dev server cycling);
                // leave the last-known count in place rather than flapping
                // to 0.
            }
        };

        void tick();
        const interval = setInterval(tick, 4000);
        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [opts.serverBaseUrl]);

    useEffect(() => {
        const baseUrl = opts.serverBaseUrl?.trim();
        const fileSystem = opts.fileSystem;

        // Push the latest component bundle on every file change as long as
        // the editor has a mobile-preview server configured and a filesystem
        // to read from. Intentionally NOT gated on `isOpen` / `status.kind`
        // so edits continue flowing to the phone after the QR modal is
        // closed — the phone only sees updates if it's connected, but the
        // server also caches the last push and replays it to late-joiners.
        if (!baseUrl || !fileSystem) {
            return;
        }

        let disposed = false;
        let pushInFlight = false;
        let pushQueued = false;
        let pushTimer: ReturnType<typeof setTimeout> | null = null;

        const pushLatestBundle = async () => {
            if (disposed) {
                return;
            }

            if (pushInFlight) {
                pushQueued = true;
                return;
            }

            pushInFlight = true;

            try {
                const bundle = await buildMobilePreviewBundle(fileSystem);
                await pushMobilePreviewUpdate({
                    serverBaseUrl: baseUrl,
                    code: bundle.code,
                });
                didPushRef.current = true;
            } catch (error) {
                const message =
                    error instanceof Error ? error.message : String(error);

                console.error(
                    '[mobile-preview] Failed to build/push preview bundle:',
                    error,
                );

                // Surface the error in the QR modal only on the very first
                // push attempt and only while the modal is actually open.
                // Transient push failures after a successful initial sync
                // shouldn't flip the modal into an error state.
                if (!didPushRef.current && !disposed && isOpen) {
                    setStatus({
                        kind: 'error',
                        message: `Failed to sync app to phone: ${message}`,
                    });
                }
            } finally {
                pushInFlight = false;

                if (pushQueued && !disposed) {
                    pushQueued = false;
                    schedulePush();
                }
            }
        };

        const schedulePush = () => {
            if (disposed) {
                return;
            }
            if (pushTimer) {
                clearTimeout(pushTimer);
            }
            pushTimer = setTimeout(() => {
                pushTimer = null;
                void pushLatestBundle();
            }, 150);
        };

        // Prefer the BroadcastChannel signal the canvas iframe uses — it
        // fires reliably on every successful rebundle (see
        // packages/browser-metro/src/host/index.ts). The file-system
        // watchDirectory signal fires during initial hydration but misses
        // some subsequent writes (e.g. inline code edits), which is why
        // auto-push previously stopped working after the first render.
        //
        // The hook runs during the canvas render, which races CodeFileSystem
        // initialization. watchDirectory throws "File system not initialized"
        // if we call it before the fs has hydrated; swallow that and fall
        // through to the BroadcastChannel path so the editor keeps rendering.
        let stopWatching: (() => void) | null = null;
        try {
            stopWatching = fileSystem.watchDirectory('/', (event) => {
                if (!shouldSyncMobilePreviewPath(event.path)) {
                    return;
                }
                schedulePush();
            });
        } catch (err) {
            console.warn(
                '[mobile-preview] fileSystem.watchDirectory unavailable (fs not ready); falling back to BroadcastChannel only.',
                err,
            );
        }

        let bundleChannel: BroadcastChannel | null = null;
        if (typeof BroadcastChannel !== 'undefined') {
            try {
                bundleChannel = new BroadcastChannel('onlook-preview');
                bundleChannel.onmessage = (event) => {
                    if (event?.data?.type === 'bundle') {
                        schedulePush();
                    }
                };
            } catch (err) {
                console.error(
                    '[mobile-preview] Failed to open BroadcastChannel:',
                    err,
                );
            }
        }

        schedulePush();

        return () => {
            disposed = true;
            if (pushTimer) {
                clearTimeout(pushTimer);
            }
            stopWatching?.();
            bundleChannel?.close();
        };
        // `isOpen` is intentionally read inside the effect (for the
        // error-surfacing guard) but omitted from the deps so toggling the
        // modal doesn't tear down and rebuild the file watcher.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [opts.fileSystem, opts.serverBaseUrl]);

    return { status, isOpen, clientCount, open, close, retry };
}
