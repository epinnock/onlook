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
    createMobilePreviewErrorStore,
    type MobilePreviewErrorPanelModel,
} from '@/services/mobile-preview/error-store';
import {
    buildMobilePreviewBundle,
    pushMobilePreviewUpdate,
    shouldSyncMobilePreviewPath,
    type MobilePreviewVfs,
} from '@/services/mobile-preview';
import type {
    MobilePreviewRuntimeMessage,
    MobilePreviewStatusResponse,
} from '@/services/mobile-preview/types';

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
    errorPanel: MobilePreviewErrorPanelModel;
    isOpen: boolean;
    open: () => Promise<void>;
    close: () => void;
    retry: () => Promise<void>;
}

type ReadyQrModalStatus = Extract<QrModalStatus, { kind: 'ready' }>;
const PACKAGE_JSON_SYNC_RETRY_COUNT = 20;
const PACKAGE_JSON_SYNC_RETRY_DELAY_MS = 250;

interface MobilePreviewRuntimeTransitionArgs {
    data: unknown;
    isOpen: boolean;
    lastReadyStatus: ReadyQrModalStatus | null;
    runtimeErrorMessage: string | null;
}

interface MobilePreviewRuntimeTransitionResult {
    nextStatus: QrModalStatus | null;
    runtimeErrorMessage: string | null;
}

function normalizeExpoSdkVersion(version: string): string | null {
    const match = version.match(/\d+(?:\.\d+){0,2}/);
    return match?.[0] ?? null;
}

function getExpoSdkMajor(version: string | null): string | null {
    if (!version) {
        return null;
    }

    const normalizedVersion = normalizeExpoSdkVersion(version);
    return normalizedVersion?.split('.')[0] ?? null;
}

export function extractProjectExpoSdkVersion(packageJson: string): string | null {
    try {
        const parsed = JSON.parse(packageJson) as {
            dependencies?: Record<string, unknown>;
            devDependencies?: Record<string, unknown>;
            peerDependencies?: Record<string, unknown>;
        };
        const expoVersion =
            parsed.dependencies?.expo ??
            parsed.devDependencies?.expo ??
            parsed.peerDependencies?.expo;

        return typeof expoVersion === 'string'
            ? normalizeExpoSdkVersion(expoVersion)
            : null;
    } catch {
        return null;
    }
}

export async function readProjectExpoSdkVersion(
    fileSystem?: MobilePreviewVfs,
): Promise<string | null> {
    if (!fileSystem) {
        return null;
    }

    for (let attempt = 0; attempt < PACKAGE_JSON_SYNC_RETRY_COUNT; attempt += 1) {
        try {
            if (
                'exists' in fileSystem &&
                typeof fileSystem.exists === 'function' &&
                !(await fileSystem.exists('package.json'))
            ) {
                await new Promise((resolve) =>
                    setTimeout(resolve, PACKAGE_JSON_SYNC_RETRY_DELAY_MS),
                );
                continue;
            }

            const packageJson = await fileSystem.readFile('package.json');
            const contents =
                typeof packageJson === 'string'
                    ? packageJson
                    : new TextDecoder().decode(packageJson);

            return extractProjectExpoSdkVersion(contents);
        } catch {
            await new Promise((resolve) =>
                setTimeout(resolve, PACKAGE_JSON_SYNC_RETRY_DELAY_MS),
            );
        }
    }

    return null;
}

export function hasMobilePreviewSdkMismatch(
    projectSdkVersion: string | null,
    runtimeSdkVersion: string | null,
): boolean {
    const projectSdkMajor = getExpoSdkMajor(projectSdkVersion);
    const runtimeSdkMajor = getExpoSdkMajor(runtimeSdkVersion);

    return !!projectSdkMajor && !!runtimeSdkMajor && projectSdkMajor !== runtimeSdkMajor;
}

export function formatMobilePreviewSdkMismatchError(
    runtimeSdkVersion: string,
    projectSdkVersion: string,
): string {
    return `Mobile preview runtime uses Expo SDK ${runtimeSdkVersion}, but this project depends on Expo SDK ${projectSdkVersion}.`;
}

export async function getMobilePreviewSdkMismatchMessage(
    fileSystem: MobilePreviewVfs | undefined,
    runtimeSdkVersion: string | null,
): Promise<string | null> {
    const projectSdkVersion = await readProjectExpoSdkVersion(fileSystem);
    if (
        !runtimeSdkVersion ||
        !projectSdkVersion ||
        !hasMobilePreviewSdkMismatch(projectSdkVersion, runtimeSdkVersion)
    ) {
        return null;
    }

    return formatMobilePreviewSdkMismatchError(runtimeSdkVersion, projectSdkVersion);
}

export function deriveMobilePreviewSocketUrl(baseUrl: string): string {
    return deriveMobilePreviewSocketUrls(baseUrl)[0] ?? baseUrl.trim();
}

export function deriveMobilePreviewSocketUrls(baseUrl: string): string[] {
    const url = new URL(baseUrl.trim());
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';

    const socketPorts = new Set<string>();
    if (url.port) {
        const port = Number.parseInt(url.port, 10);
        if (!Number.isNaN(port)) {
            socketPorts.add(String(port + 1));
            if (port >= 8700 && port < 8900) {
                socketPorts.add(String(port + 100));
            }
        }
    }

    if (!socketPorts.size) {
        url.pathname = '/';
        url.search = '';
        url.hash = '';
        return [url.toString()];
    }

    return [...socketPorts].map((port) => {
        const socketUrl = new URL(url.toString());
        socketUrl.port = port;
        socketUrl.pathname = '/';
        socketUrl.search = '';
        socketUrl.hash = '';
        return socketUrl.toString();
    });
}

export function parseMobilePreviewRuntimeMessage(
    data: unknown,
): MobilePreviewRuntimeMessage | null {
    if (typeof data !== 'string') {
        return null;
    }

    try {
        const parsed = JSON.parse(data) as MobilePreviewRuntimeMessage;
        if (!parsed || typeof parsed !== 'object' || typeof parsed.type !== 'string') {
            return null;
        }
        return parsed;
    } catch {
        return null;
    }
}

export function formatMobilePreviewRuntimeError(message: string): string {
    return `Mobile preview runtime error: ${message}`;
}

export function reduceMobilePreviewRuntimeMessage(
    args: MobilePreviewRuntimeTransitionArgs,
): MobilePreviewRuntimeTransitionResult {
    const runtimeMessage = parseMobilePreviewRuntimeMessage(args.data);
    if (!runtimeMessage) {
        return {
            nextStatus: null,
            runtimeErrorMessage: args.runtimeErrorMessage,
        };
    }

    if (runtimeMessage.type === 'evalError' && typeof runtimeMessage.error === 'string') {
        const runtimeErrorMessage = runtimeMessage.error.trim();
        if (!runtimeErrorMessage) {
            return {
                nextStatus: null,
                runtimeErrorMessage: args.runtimeErrorMessage,
            };
        }

        return {
            nextStatus: {
                kind: 'error',
                message: formatMobilePreviewRuntimeError(runtimeErrorMessage),
            },
            runtimeErrorMessage,
        };
    }

    if (runtimeMessage.type === 'evalResult' && args.runtimeErrorMessage) {
        return {
            nextStatus: args.isOpen ? (args.lastReadyStatus ?? { kind: 'idle' }) : { kind: 'idle' },
            runtimeErrorMessage: null,
        };
    }

    return {
        nextStatus: null,
        runtimeErrorMessage: args.runtimeErrorMessage,
    };
}

export function useMobilePreviewStatus(
    opts: UseMobilePreviewStatusOptions,
): UseMobilePreviewStatusResult {
    const [status, setStatus] = useState<QrModalStatus>({ kind: 'idle' });
    const errorStoreRef = useRef(createMobilePreviewErrorStore());
    const [errorPanel, setErrorPanel] = useState<MobilePreviewErrorPanelModel>(
        () => errorStoreRef.current.getPanelModel(),
    );
    const [isOpen, setIsOpen] = useState(false);
    const didPushRef = useRef(false);
    const isOpenRef = useRef(false);
    const readyStatusRef = useRef<ReadyQrModalStatus | null>(null);
    const runtimeErrorMessageRef = useRef<string | null>(null);

    isOpenRef.current = isOpen;

    const syncErrorPanel = useCallback(() => {
        setErrorPanel(errorStoreRef.current.getPanelModel());
    }, []);

    const recordPushError = useCallback(
        (message: string) => {
            errorStoreRef.current.recordPushError(message);
            syncErrorPanel();
        },
        [syncErrorPanel],
    );

    const clearPushError = useCallback(() => {
        errorStoreRef.current.clearPushError();
        syncErrorPanel();
    }, [syncErrorPanel]);

    const recordRuntimeError = useCallback(
        (message: string) => {
            errorStoreRef.current.recordRuntimeError(message);
            syncErrorPanel();
        },
        [syncErrorPanel],
    );

    const clearRuntimeError = useCallback(() => {
        errorStoreRef.current.clearRuntimeError();
        syncErrorPanel();
    }, [syncErrorPanel]);

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

            const sdkMismatchMessage = await getMobilePreviewSdkMismatchMessage(
                opts.fileSystem,
                body.runtimeSdkVersion,
            );
            if (sdkMismatchMessage) {
                setStatus({
                    kind: 'error',
                    message: sdkMismatchMessage,
                });
                return;
            }

            const qrSvg = await renderQrSvg(body.manifestUrl);
            const readyStatus = {
                kind: 'ready',
                manifestUrl: body.manifestUrl,
                qrSvg,
            } satisfies ReadyQrModalStatus;
            readyStatusRef.current = readyStatus;

            if (runtimeErrorMessageRef.current) {
                setStatus({
                    kind: 'error',
                    message: formatMobilePreviewRuntimeError(
                        runtimeErrorMessageRef.current,
                    ),
                });
                return;
            }

            setStatus(readyStatus);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setStatus({
                kind: 'error',
                message: `Failed to reach mobile-preview server: ${message}`,
            });
        }
    }, [opts.fileSystem, opts.serverBaseUrl]);

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
        if (!baseUrl || typeof WebSocket === 'undefined') {
            return;
        }

        let disposed = false;
        let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
        let socket: WebSocket | null = null;
        const socketUrls = deriveMobilePreviewSocketUrls(baseUrl);
        let socketUrlIndex = 0;

        const connect = () => {
            if (disposed) {
                return;
            }

            try {
                socket = new WebSocket(
                    socketUrls[socketUrlIndex] ?? deriveMobilePreviewSocketUrl(baseUrl),
                );
            } catch (error) {
                console.error(
                    '[mobile-preview] Failed to open status WebSocket:',
                    error,
                );
                return;
            }

            socket.onmessage = (event) => {
                const previousRuntimeErrorMessage = runtimeErrorMessageRef.current;
                const transition = reduceMobilePreviewRuntimeMessage({
                    data: event.data,
                    isOpen: isOpenRef.current,
                    lastReadyStatus: readyStatusRef.current,
                    runtimeErrorMessage: runtimeErrorMessageRef.current,
                });

                runtimeErrorMessageRef.current = transition.runtimeErrorMessage;

                if (
                    transition.runtimeErrorMessage &&
                    transition.runtimeErrorMessage !== previousRuntimeErrorMessage
                ) {
                    recordRuntimeError(transition.runtimeErrorMessage);
                }

                if (
                    !transition.runtimeErrorMessage &&
                    previousRuntimeErrorMessage
                ) {
                    clearRuntimeError();
                }

                if (transition.nextStatus) {
                    setStatus(transition.nextStatus);
                }
            };

            socket.onclose = () => {
                if (disposed) {
                    return;
                }

                socketUrlIndex = (socketUrlIndex + 1) % socketUrls.length;
                reconnectTimer = setTimeout(() => {
                    reconnectTimer = null;
                    connect();
                }, 500);
            };
        };

        connect();

        return () => {
            disposed = true;
            if (reconnectTimer) {
                clearTimeout(reconnectTimer);
            }
            socket?.close();
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
                clearPushError();
            } catch (error) {
                const message =
                    error instanceof Error ? error.message : String(error);

                console.error(
                    '[mobile-preview] Failed to build/push preview bundle:',
                    error,
                );
                recordPushError(message);

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
        const stopWatching = fileSystem.watchDirectory('/', (event) => {
            if (!shouldSyncMobilePreviewPath(event.path)) {
                return;
            }
            schedulePush();
        });

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
            stopWatching();
            bundleChannel?.close();
        };
        // `isOpen` is intentionally read inside the effect (for the
        // error-surfacing guard) but omitted from the deps so toggling the
        // modal doesn't tear down and rebuild the file watcher.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [clearPushError, opts.fileSystem, opts.serverBaseUrl, recordPushError]);

    return { status, errorPanel, isOpen, open, close, retry };
}
