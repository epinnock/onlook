'use client';

import { useCallback, useEffect, useState } from 'react';

const DEFAULT_POLL_INTERVAL_MS = 5_000;

interface MobilePreviewConnectionResponse {
    clients?: number;
    runtimeHash?: string | null;
}

export type MobilePreviewConnectionStatus =
    | {
          kind: 'disabled';
          clients: 0;
          hasRuntime: false;
          message: string;
      }
    | {
          kind: 'checking';
          clients: 0;
          hasRuntime: false;
      }
    | {
          kind: 'waiting';
          clients: number;
          hasRuntime: boolean;
      }
    | {
          kind: 'connected';
          clients: number;
          hasRuntime: boolean;
      }
    | {
          kind: 'error';
          clients: 0;
          hasRuntime: false;
          message: string;
      };

export interface UseMobilePreviewConnectionOptions {
    serverBaseUrl?: string;
    enabled?: boolean;
    pollIntervalMs?: number;
}

export interface UseMobilePreviewConnectionResult {
    status: MobilePreviewConnectionStatus;
    refresh: () => Promise<void>;
}

export interface FetchMobilePreviewConnectionArgs {
    serverBaseUrl?: string;
    enabled?: boolean;
    fetchFn?: typeof fetch;
}

function disabledStatus(): MobilePreviewConnectionStatus {
    return {
        kind: 'disabled',
        clients: 0,
        hasRuntime: false,
        message:
            'Missing mobile preview server URL — set NEXT_PUBLIC_MOBILE_PREVIEW_URL.',
    };
}

function checkingStatus(): MobilePreviewConnectionStatus {
    return {
        kind: 'checking',
        clients: 0,
        hasRuntime: false,
    };
}

function trimBaseUrl(serverBaseUrl: string | undefined): string | undefined {
    const trimmed = serverBaseUrl?.trim();
    return trimmed ? trimmed.replace(/\/$/, '') : undefined;
}

export async function fetchMobilePreviewConnection(
    args: FetchMobilePreviewConnectionArgs,
): Promise<MobilePreviewConnectionStatus> {
    const baseUrl = trimBaseUrl(args.serverBaseUrl);
    if (args.enabled === false || !baseUrl) {
        return disabledStatus();
    }

    const fetchFn = args.fetchFn ?? fetch;

    try {
        const res = await fetchFn(`${baseUrl}/status`, {
            method: 'GET',
            cache: 'no-store',
        });

        if (!res.ok) {
            return {
                kind: 'error',
                clients: 0,
                hasRuntime: false,
                message: `mobile-preview /status returned ${res.status}`,
            };
        }

        const body = (await res.json()) as MobilePreviewConnectionResponse;
        const clients =
            typeof body.clients === 'number' && body.clients > 0
                ? Math.floor(body.clients)
                : 0;
        const hasRuntime =
            typeof body.runtimeHash === 'string' && body.runtimeHash.length > 0;

        if (clients > 0) {
            return {
                kind: 'connected',
                clients,
                hasRuntime,
            };
        }

        return {
            kind: 'waiting',
            clients: 0,
            hasRuntime,
        };
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            kind: 'error',
            clients: 0,
            hasRuntime: false,
            message: `Failed to reach mobile-preview server: ${message}`,
        };
    }
}

function getInitialStatus(
    opts: UseMobilePreviewConnectionOptions,
): MobilePreviewConnectionStatus {
    const baseUrl = trimBaseUrl(opts.serverBaseUrl);
    if (opts.enabled === false || !baseUrl) {
        return disabledStatus();
    }
    return checkingStatus();
}

export function useMobilePreviewConnection(
    opts: UseMobilePreviewConnectionOptions,
): UseMobilePreviewConnectionResult {
    const [status, setStatus] = useState<MobilePreviewConnectionStatus>(() =>
        getInitialStatus(opts),
    );

    const refresh = useCallback(async () => {
        const next = await fetchMobilePreviewConnection({
            serverBaseUrl: opts.serverBaseUrl,
            enabled: opts.enabled,
        });
        setStatus(next);
    }, [opts.enabled, opts.serverBaseUrl]);

    useEffect(() => {
        const baseUrl = trimBaseUrl(opts.serverBaseUrl);
        if (opts.enabled === false || !baseUrl) {
            setStatus(disabledStatus());
            return;
        }

        let cancelled = false;
        const pollIntervalMs = opts.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;

        const poll = async () => {
            const next = await fetchMobilePreviewConnection({
                serverBaseUrl: baseUrl,
                enabled: true,
            });
            if (!cancelled) {
                setStatus(next);
            }
        };

        setStatus(checkingStatus());
        void poll();

        const interval = setInterval(() => {
            void poll();
        }, pollIntervalMs);

        return () => {
            cancelled = true;
            clearInterval(interval);
        };
    }, [opts.enabled, opts.pollIntervalMs, opts.serverBaseUrl]);

    return { status, refresh };
}
