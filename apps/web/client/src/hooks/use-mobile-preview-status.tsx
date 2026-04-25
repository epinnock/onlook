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

import type {
    AbiHelloMessage,
    OnlookRuntimeError,
    RuntimeCapabilities,
} from '@onlook/mobile-client-protocol';

import type { QrModalStatus } from '@/components/ui/qr-modal';
import type { RelayWsClient } from '@/services/expo-relay/relay-ws-client';
import type { MobilePreviewPipeline, MobilePreviewVfs } from '@/services/mobile-preview';
import { renderQrSvg } from '@/services/expo-relay';
import { parseManifestUrl } from '@/services/expo-relay/manifest-url';
import { emitOverlayAckTelemetry } from '@/services/expo-relay/overlay-telemetry-sink';
import {
    createSourceMapCache,
    wireBufferDecorationOnError,
} from '@/services/expo-relay/source-map-cache';
import {
    buildMobilePreviewBundle,
    createMobilePreviewPipeline,
    pushMobilePreviewUpdate,
    resolveMobilePreviewPipelineConfig,
    shouldSyncMobilePreviewPath,
} from '@/services/mobile-preview';
import { isAnyMobilePreviewOverlayPipelineEnabled } from '@/services/mobile-preview/pipeline-flag';
import { registerTwoTierEsbuildServiceFactory } from '@/services/mobile-preview/pipelines/two-tier';
import { useRelayWsClient } from './use-relay-ws-client';

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
    /**
     * Phase 11b — latest AbiHello compatibility result. `'unknown'`
     * until the phone sends its hello on the current socket; flips to
     * `'ok'` or an `OnlookRuntimeError` on receipt; resets to
     * `'unknown'` on socket close + reconnect. Pass to
     * `<MobileDevPanel abiCompatibility={...}>` to render the
     * AbiCompatibilityIndicator.
     */
    abiCompatibility: 'unknown' | 'ok' | OnlookRuntimeError;
    /**
     * Phase 11b — last AbiHello received from the phone, surfaced
     * via the indicator's hover title for debugging the binary's
     * advertised capabilities (rnVersion / expoSdk / aliases). Null
     * when the handshake has not completed.
     */
    phoneHello: AbiHelloMessage | null;
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
                const result = await esbuild.build(options as Parameters<typeof esbuild.build>[0]);
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
    // Phase 11b — RelayWsClient ref for the compatibility-provider closure.
    // The provider is captured at pipeline-construction time but called on
    // every push, so it dereferences the ref lazily. This handles the
    // common timing where the pipeline is constructed BEFORE the relay WS
    // has connected (the file-watch effect can fire on first edit before
    // the user opens the QR modal). When the ref is null/disconnected the
    // provider returns 'unknown', which fails-closed in pushOverlayV1.
    const relayWsClientRef = useRef<RelayWsClient | null>(null);

    const open = useCallback(async () => {
        setIsOpen(true);
        didPushRef.current = false;

        const baseUrl = opts.serverBaseUrl?.trim();
        if (!baseUrl) {
            setStatus({
                kind: 'error',
                message: 'Missing mobile preview server URL — set NEXT_PUBLIC_MOBILE_PREVIEW_URL.',
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
                // Phase 11a routes both 'two-tier' (legacy push shape) and
                // 'overlay-v1' (ABI v1 push shape) through the same TwoTier
                // pipeline class — the inner sync() flag picks which push
                // function fires. Without this kind-aware gate, env=overlay-v1
                // silently fell back to the shim path and pushOverlayV1 was
                // unreachable from production.
                if (isAnyMobilePreviewOverlayPipelineEnabled()) {
                    ensureTwoTierEsbuildFactoryRegistered();
                    if (!pipelineRef.current) {
                        pipelineRef.current = createMobilePreviewPipeline(
                            resolveMobilePreviewPipelineConfig(),
                            {
                                // Phase 11b: gate v1 pushes on the editor's
                                // handshake state. Lazy ref read on every
                                // push — pipeline construction runs once,
                                // but the relayWs client may connect later.
                                compatibilityProvider: () =>
                                    relayWsClientRef.current?.getLastAbiCompatibility() ??
                                    'unknown',
                                // Phase 9 R2 source-map upload — when
                                // result.sourceMap is present, the pipeline
                                // PUTs it to /base-bundle/assets/<sha256>
                                // and calls this back with the resulting
                                // URI. Stored into the ref the
                                // wireBufferDecorationOnError resolver
                                // reads, so onlook:error decoration starts
                                // mapping `bundle.js:line:col` frames
                                // back to original source — closes the
                                // row #35 receive-chain end-to-end.
                                onSourceMapUploaded: (url: string) => {
                                    lastOverlayMetaSourceMapUrlRef.current = url;
                                },
                            },
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
                const message = error instanceof Error ? error.message : String(error);

                console.error('[mobile-preview] Failed to build/push preview bundle:', error);

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
                console.error('[mobile-preview] Failed to open BroadcastChannel:', err);
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
        isOpen && status.kind === 'ready' && status.manifestUrl ? status.manifestUrl : null;
    // Phase 11b — track the most recent handshake outcome in React
    // state so the dev-panel re-renders when it changes. The
    // `abiCompatibility` value flows into the AbiCompatibilityIndicator
    // and (more importantly) gates pushOverlayV1 via the
    // compatibilityProvider already wired at line 234. Reset to
    // 'unknown' when the WS reconnects — the relay also resets its
    // cached state on socket close so this stays in sync.
    const [abiCompatibility, setAbiCompatibility] = useState<
        'unknown' | 'ok' | OnlookRuntimeError
    >('unknown');
    const [phoneHello, setPhoneHello] = useState<AbiHelloMessage | null>(null);
    // The editor side of the AbiHello carries stub capabilities — the
    // editor isn't a phone; checkAbiCompatibility on the phone only
    // gates on the abi version equality. The values below are
    // documented as informational in `RuntimeCapabilities` and are
    // refined when base-bundle wiring lands. Build once, reuse across
    // reconnects.
    const editorCapabilities = useRef<RuntimeCapabilities>({
        abi: 'v1',
        baseHash: 'editor',
        rnVersion: '0.81.6',
        expoSdk: '54.0.0',
        platform: 'ios',
        aliases: [],
    });
    // Phase 11b row #35 source-map decoration —
    // `lastOverlayMetaSourceMapUrl` ref is set by the production
    // pipeline call site after a successful pushOverlayV1 with a
    // populated `meta.sourceMapUrl`. Today the v1 push branch in
    // `two-tier.ts:317` omits sourceMap pending Phase 9 R2 upload —
    // so this ref stays null and decoration is a fail-soft no-op
    // (see wireBufferDecorationOnError tests). When R2 upload lands,
    // the pipeline updates this ref via a deps callback (next tick's
    // wire-up); decoration starts working automatically with no
    // changes here. Per-session ref because a different sessionId
    // means a different overlay history — we never want to apply
    // session-A's map URL to session-B's error.
    const lastOverlayMetaSourceMapUrlRef = useRef<string | null>(null);
    // Reset the URL ref on session change for the same reason
    // abiCompatibility resets — a different phone connection means a
    // fresh overlay timeline.
    useEffect(() => {
        lastOverlayMetaSourceMapUrlRef.current = null;
    }, [manifestUrlForRelay]);
    // Cache + handler are stable across renders. The cache is owned at
    // the hook scope (one per editor session) so identical map URLs
    // share fetches; the handler is the pre-built closure that the
    // useRelayWsClient handlers slot expects.
    const sourceMapCacheRef = useRef(createSourceMapCache());
    // Reset the cached compatibility every time the manifestUrl
    // changes — a different session means a different phone, so
    // last-write-wins from a stale connection must not leak through.
    useEffect(() => {
        setAbiCompatibility('unknown');
        setPhoneHello(null);
    }, [manifestUrlForRelay]);
    // Compose the source-map decoration handler. The closure captures
    // `relayWsClientRef` (declared above) for the buffer-replace
    // primitive — useState-driven re-render isn't required because
    // `replaceMessageMatching` mutates the buffer in place; the
    // dev-panel reads via `getSnapshot()` which sees the updated
    // entry on the next snapshot call.
    const decorationOnError = useCallback(
        wireBufferDecorationOnError({
            cache: sourceMapCacheRef.current,
            resolveMapUrl: () => lastOverlayMetaSourceMapUrlRef.current,
            // Adapter: widen the predicate/replacer from ErrorMessage to
            // the buffer's full message union. RelayWsClient.replaceMessageMatching
            // operates on `WsMessage | OverlayAckMessage`; we narrow with
            // the predicate's `m.type === 'onlook:error'` check, which the
            // helper sets up internally before invoking us.
            replaceMatching: (predicate, replacer) => {
                const c = relayWsClientRef.current;
                if (c === null) return false;
                return c.replaceMessageMatching(
                    (m) => m.type === 'onlook:error' && predicate(m),
                    (m) =>
                        m.type === 'onlook:error' ? replacer(m) : m,
                );
            },
        }),
        [],
    );
    const { client: relayWsClient } = useRelayWsClient({
        manifestUrl: manifestUrlForRelay,
        editorCapabilities: editorCapabilities.current,
        // Preserve the default `onOverlayAck` PostHog telemetry by
        // explicitly setting it alongside the new onError. Replacing
        // the entire handlers object DROPS defaults (see
        // useRelayWsClient header docstring).
        handlers: {
            onOverlayAck: emitOverlayAckTelemetry,
            onError: decorationOnError,
        },
        onAbiCompatibility: useCallback(
            (result: 'ok' | OnlookRuntimeError, hello: AbiHelloMessage) => {
                setAbiCompatibility(result);
                setPhoneHello(hello);
            },
            [],
        ),
    });
    // Mirror the live client into the ref the file-watch closure reads —
    // assign-on-render is the standard react pattern for "give me the
    // latest value inside a stable callback." See `relayWsClientRef`
    // declaration for why a ref is required (push runs in a closure built
    // before the relayWs is connected).
    relayWsClientRef.current = relayWsClient;

    // Phase 11b reconnect-recovery — when the phone connects mid-session
    // and the handshake completes, the editor's accumulated edits never
    // reached the relay because the compatibility gate fail-closed every
    // pushOverlayV1 call while compat='unknown'. Trigger a manual
    // pipeline.sync() on the unknown→ok transition so the latest file
    // state lands on the freshly-handshook phone. Same recovery shape as
    // services/expo-relay/reconnect-replayer.ts but via the pipeline
    // (which knows how to build the overlay) rather than a separate
    // re-push helper.
    //
    // Skipped on initial 'unknown' (no transition yet). Skipped when no
    // file system or pipeline is available. Errors swallowed — a manual
    // re-sync failing must not surface a confusing error in the UI; the
    // next regular file-edit sync will pick up.
    const prevAbiCompatRef = useRef<typeof abiCompatibility>('unknown');
    useEffect(() => {
        const prev = prevAbiCompatRef.current;
        prevAbiCompatRef.current = abiCompatibility;
        if (prev === abiCompatibility) return;
        if (abiCompatibility !== 'ok') return;
        const fs = opts.fileSystem;
        const pipeline = pipelineRef.current;
        if (!fs || !pipeline) return;
        // Fire-and-forget. The file-watch effect already handles error
        // surfacing for regular edits; this catch-up sync is best-effort.
        pipeline
            .sync({ fileSystem: fs })
            .catch((err) => {
                console.warn(
                    '[mobile-preview] reconnect re-sync failed (will retry on next edit):',
                    err,
                );
            });
    }, [abiCompatibility, opts.fileSystem]);

    // Derive sessionId from the ready-state manifestUrl so dev-panel
    // callers can filter streams by session without re-implementing
    // parseManifestUrl. Null on non-ready states (idle/opening/failed)
    // or on malformed URLs — same nullability contract as relayWsClient.
    const sessionId =
        status.kind === 'ready' && status.manifestUrl
            ? (parseManifestUrl(status.manifestUrl)?.bundleHash ?? null)
            : null;

    return {
        status,
        isOpen,
        open,
        close,
        retry,
        relayWsClient,
        sessionId,
        abiCompatibility,
        phoneHello,
    };
}
