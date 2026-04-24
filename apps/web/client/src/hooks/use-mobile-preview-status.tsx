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
import { parseManifestUrl } from '@/services/expo-relay/manifest-url';
import type { RelayWsClient } from '@/services/expo-relay/relay-ws-client';
import {
    buildMobilePreviewBundle,
    createMobilePreviewPipeline,
    getMobilePreviewPipelineKind,
    pushMobilePreviewUpdate,
    resolveMobilePreviewPipelineConfig,
    shouldSyncMobilePreviewPath,
    type MobilePreviewPipeline,
    type MobilePreviewVfs,
} from '@/services/mobile-preview';
import { registerTwoTierEsbuildServiceFactory } from '@/services/mobile-preview/pipelines/two-tier';

import { useRelayWsClient } from './use-relay-ws-client';

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
    open: () => Promise<void>;
    close: () => void;
    retry: () => Promise<void>;
    /**
     * Relay WS client opened against `/hmr/:sessionId` when `status`
     * is `'ready'` and a valid manifestUrl is available. Null
     * otherwise. Exposed so dev-panel surfaces (MobileDevPanel,
     * MobileOverlayAckTab) can tap `.snapshot()` for live data.
     *
     * Phase 11b Q5b eval-latency telemetry (`emitOverlayAckTelemetry`)
     * fires as the default `onOverlayAck` handler — no additional
     * wire-in needed for the PostHog soak signal to start flowing.
     */
    relayWsClient: RelayWsClient | null;
    /**
     * Preview session id — the bundleHash extracted from the ready-
     * state manifestUrl. Null unless `status.kind === 'ready'` AND the
     * URL is well-formed. MobileDevPanel uses this to filter its tabs
     * so the console / network / acks streams only show events from
     * the currently-connected session (stale ids from a prior boot are
     * dropped). Resolves the Phase 9 TODO previously documented in
     * `MobilePreviewDevPanelContainer.extractSessionId`.
     */
    sessionId: string | null;
}

interface MobilePreviewStatusResponse {
    runtimeHash: string | null;
    clients: number;
    manifestUrl: string | null;
}

// Lazy-initialized esbuild-wasm service. The browser-bundler runs its
// bundle inside a Web Worker in production; here we initialize once per
// editor tab and share across pipeline instances.
let twoTierEsbuildFactoryRegistered = false;
function ensureTwoTierEsbuildFactoryRegistered(): void {
    if (twoTierEsbuildFactoryRegistered) return;
    twoTierEsbuildFactoryRegistered = true;
    registerTwoTierEsbuildServiceFactory(async () => {
        const esbuild = (await import('esbuild-wasm')) as typeof import('esbuild-wasm');
        await esbuild.initialize({ wasmURL: '/esbuild.wasm' });
        return {
            async build(options) {
                const result = await esbuild.build(
                    options as Parameters<typeof esbuild.build>[0],
                );
                return {
                    outputFiles: result.outputFiles?.map((f) => ({
                        path: f.path,
                        text: f.text,
                    })),
                    warnings: result.warnings,
                };
            },
        };
    });
}

export function useMobilePreviewStatus(
    opts: UseMobilePreviewStatusOptions,
): UseMobilePreviewStatusResult {
    const [status, setStatus] = useState<QrModalStatus>({ kind: 'idle' });
    const [isOpen, setIsOpen] = useState(false);
    const didPushRef = useRef(false);
    // Stable pipeline ref across renders — creating a new pipeline per
    // push discards the incremental-rebuild cache inside TwoTier.
    const pipelineRef = useRef<MobilePreviewPipeline | null>(null);

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
            if (!body.manifestUrl) {
                setStatus({
                    kind: 'error',
                    message:
                        'mobile-preview server reachable but runtime not staged — restart the server.',
                });
                return;
            }

            const qrSvg = await renderQrSvg(body.manifestUrl);
            // Shim path doesn't mint Onlook deep-links the way the
            // two-tier pipeline does — the manifest URL IS what the phone
            // scans / opens. Pass it as onlookUrl so the QrModalBody's
            // "Copy Onlook URL" button copies the scannable URL.
            setStatus({
                kind: 'ready',
                manifestUrl: body.manifestUrl,
                onlookUrl: body.manifestUrl,
                qrSvg,
            });
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
                // Two-tier path: drive through the pipeline abstraction so
                // the browser-bundler worker + /push client take over. The
                // shim path stays as-is for legacy consumers.
                if (getMobilePreviewPipelineKind() === 'two-tier') {
                    ensureTwoTierEsbuildFactoryRegistered();
                    if (!pipelineRef.current) {
                        pipelineRef.current = createMobilePreviewPipeline(
                            resolveMobilePreviewPipelineConfig(),
                        );
                    }
                    await pipelineRef.current.sync({ fileSystem });
                    didPushRef.current = true;
                } else {
                    const bundle = await buildMobilePreviewBundle(fileSystem);
                    await pushMobilePreviewUpdate({
                        serverBaseUrl: baseUrl,
                        code: bundle.code,
                    });
                    didPushRef.current = true;
                }
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
        // Guard against an uninitialized file system — CodeFileSystem
        // throws synchronously from `watchDirectory` before its underlying
        // provider session has started. When a user lands on a project
        // whose sandbox hasn't booted yet, we still render the preview
        // button but defer the subscription; the BroadcastChannel branch
        // below remains the primary push signal in that window.
        let stopWatching: (() => void) | null = null;
        let fileSystemReady = false;
        try {
            stopWatching = fileSystem.watchDirectory('/', (event) => {
                if (!shouldSyncMobilePreviewPath(event.path)) {
                    return;
                }
                schedulePush();
            });
            fileSystemReady = true;
        } catch (err) {
            console.warn(
                '[mobile-preview] watchDirectory unavailable (fileSystem not initialized); ' +
                    'falling back to BroadcastChannel signal.',
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

        // Only fire the initial push when the filesystem was actually
        // available — otherwise pushLatestBundle immediately trips on
        // fileSystem.listAll() for the same "File system not initialized"
        // reason, logging a misleading error on every render. The
        // BroadcastChannel onmessage path below will kick off the first
        // push once the canvas iframe hydrates and broadcasts its first
        // bundle event.
        if (fileSystemReady) {
            schedulePush();
        }

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

    // Phase 9 Task A / ADR-0009 Q5b — open a RelayWsClient whenever
    // the status is ready AND the modal is open. The hook is inert
    // when `manifestUrl` is null (parseManifestUrl returns null on
    // invalid input). `emitOverlayAckTelemetry` fires as the default
    // ack handler, so Phase 11b PostHog signal flows for free with no
    // additional wire-in. Gated on `isOpen` to avoid opening a
    // long-lived WS in the background when the modal is closed.
    const manifestUrlForRelay =
        isOpen && status.kind === 'ready' && status.manifestUrl
            ? status.manifestUrl
            : null;
    const { client: relayWsClient } = useRelayWsClient({
        manifestUrl: manifestUrlForRelay,
    });

    // Derive sessionId from the ready-state manifestUrl so dev-panel
    // callers can filter streams by session without re-implementing
    // parseManifestUrl. Null on non-ready states (idle/opening/failed)
    // or on malformed URLs — same nullability contract as relayWsClient.
    const sessionId =
        status.kind === 'ready' && status.manifestUrl
            ? (parseManifestUrl(status.manifestUrl)?.bundleHash ?? null)
            : null;

    return { status, isOpen, open, close, retry, relayWsClient, sessionId };
}
