'use client';

/**
 * usePreviewInBrowser — the Spectra-side sibling of `usePreviewOnDevice`.
 *
 * Reuses `BuildOrchestrator.build()` to produce a bundleHash, then:
 *   1. Calls `spectra.createSession` (which provisions a sim, auto-installs
 *      the OnlookMobileClient app, and — in the same round trip — opens the
 *      `onlook://` deep link).
 *   2. Spawns an **ephemeral** simulator frame on the canvas so the user
 *      sees the live stream alongside their web frame.
 *   3. Tears down the sim + removes the frame on `close()`.
 *
 * Gated by `NEXT_PUBLIC_FEATURE_SPECTRA_PREVIEW` — if the flag is off, the
 * hook's `open()` short-circuits into an error state.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { v4 as uuid } from 'uuid';

import type { CodeFileSystem } from '@onlook/file-system';
import type { Frame } from '@onlook/models';

import { useEditorEngine } from '@/components/store/editor';
import { env } from '@/env';
import { api } from '@/trpc/react';
import {
    BuilderClient,
    BuildOrchestrator,
} from '@/services/expo-builder';
import {
    buildManifestUrl,
    buildOnlookDeepLink,
} from '@/services/expo-relay';

export type PreviewInBrowserStatus =
    | { kind: 'idle' }
    | { kind: 'building' }
    | { kind: 'launching' }
    | { kind: 'ready'; sessionId: string; frameId: string }
    | { kind: 'error'; message: string };

export interface UsePreviewInBrowserOptions {
    fs: CodeFileSystem;
    projectId: string;
    branchId: string;
    builderBaseUrl?: string;
    relayBaseUrl?: string;
}

export interface UsePreviewInBrowserResult {
    status: PreviewInBrowserStatus;
    isOpen: boolean;
    open: () => Promise<void>;
    close: () => Promise<void>;
    retry: () => Promise<void>;
}

const DEFAULT_DIMENSION = { width: 390, height: 844 };

function nonEmpty(v: string | undefined): string | undefined {
    return v && v.length > 0 ? v : undefined;
}

export function usePreviewInBrowser(
    opts: UsePreviewInBrowserOptions,
): UsePreviewInBrowserResult {
    const editorEngine = useEditorEngine();
    const [status, setStatus] = useState<PreviewInBrowserStatus>({ kind: 'idle' });
    const [isOpen, setIsOpen] = useState(false);
    const orchestratorRef = useRef<BuildOrchestrator | null>(null);
    const sessionIdRef = useRef<string | null>(null);
    const frameIdRef = useRef<string | null>(null);

    const createSession = api.spectra.createSession.useMutation();
    const endSession = api.spectra.endSession.useMutation();

    const teardown = useCallback(async () => {
        const frameId = frameIdRef.current;
        const sessionId = sessionIdRef.current;
        frameIdRef.current = null;
        sessionIdRef.current = null;

        if (frameId) {
            try {
                editorEngine.frames.removeEphemeral(frameId);
            } catch {
                // best effort
            }
        }
        if (sessionId) {
            try {
                await endSession.mutateAsync({ sessionId });
            } catch {
                // Server-side registry sweeper will clean up eventually.
            }
        }

        orchestratorRef.current?.dispose();
        orchestratorRef.current = null;
    }, [editorEngine.frames, endSession]);

    const open = useCallback(async () => {
        setIsOpen(true);

        if (!env.NEXT_PUBLIC_FEATURE_SPECTRA_PREVIEW) {
            setStatus({
                kind: 'error',
                message: 'Spectra preview is not enabled on this server.',
            });
            return;
        }

        const builderBaseUrl = nonEmpty(opts.builderBaseUrl);
        const relayBaseUrl = nonEmpty(opts.relayBaseUrl);
        if (!builderBaseUrl) {
            setStatus({ kind: 'error', message: 'Missing builder base URL (NEXT_PUBLIC_CF_ESM_BUILDER_URL).' });
            return;
        }
        if (!relayBaseUrl) {
            setStatus({ kind: 'error', message: 'Missing relay base URL (NEXT_PUBLIC_CF_EXPO_RELAY_URL).' });
            return;
        }

        await teardown();

        try {
            setStatus({ kind: 'building' });
            const client = new BuilderClient({ baseUrl: builderBaseUrl });
            const orchestrator = new BuildOrchestrator({
                client,
                fs: opts.fs,
                projectId: opts.projectId,
                branchId: opts.branchId,
            });
            orchestratorRef.current = orchestrator;
            const result = await orchestrator.build();
            if (result.state !== 'ready' || !result.bundleHash) {
                setStatus({
                    kind: 'error',
                    message: result.error ?? `Build ended in state=${result.state}`,
                });
                return;
            }

            const onlookUrl = buildOnlookDeepLink(result.bundleHash, { relayBaseUrl });
            // `buildManifestUrl` is unused here but kept for potential
            // future "fallback to Expo Go" link surfacing.
            buildManifestUrl(result.bundleHash, { relayBaseUrl });

            setStatus({ kind: 'launching' });
            const session = await createSession.mutateAsync({ deepLinkUrl: onlookUrl });
            sessionIdRef.current = session.sessionId;

            const frame: Frame = {
                id: uuid(),
                canvasId: editorEngine.canvas.id,
                branchId: opts.branchId,
                url: `spectra://${session.sessionId}`,
                position: nextFramePosition(editorEngine),
                dimension: DEFAULT_DIMENSION,
                kind: 'simulator',
                simulatorSessionId: session.sessionId,
            };
            editorEngine.frames.createEphemeral(frame);
            frameIdRef.current = frame.id;

            setStatus({ kind: 'ready', sessionId: session.sessionId, frameId: frame.id });
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            setStatus({ kind: 'error', message });
            await teardown();
        }
    }, [
        opts.fs,
        opts.projectId,
        opts.branchId,
        opts.builderBaseUrl,
        opts.relayBaseUrl,
        editorEngine,
        createSession,
        teardown,
    ]);

    const close = useCallback(async () => {
        setIsOpen(false);
        setStatus({ kind: 'idle' });
        await teardown();
    }, [teardown]);

    // Best-effort teardown on page unload. tRPC mutations from `beforeunload`
    // get killed by the navigation, so we fall back to `sendBeacon` hitting
    // the dedicated end-session Route Handler.
    useEffect(() => {
        function handleUnload() {
            const sessionId = sessionIdRef.current;
            if (!sessionId) return;
            try {
                const url = `/api/spectra/end-session?sessionId=${encodeURIComponent(sessionId)}`;
                if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
                    navigator.sendBeacon(url);
                }
            } catch {
                // Nothing we can do — server sweeper will eventually reap.
            }
        }
        window.addEventListener('beforeunload', handleUnload);
        return () => window.removeEventListener('beforeunload', handleUnload);
    }, []);

    // Teardown on hook unmount (route navigation inside the SPA).
    useEffect(() => {
        return () => {
            void teardown();
        };
    }, [teardown]);

    const retry = useCallback(async () => {
        await open();
    }, [open]);

    return { status, isOpen, open, close, retry };
}

/**
 * Pick a position for the ephemeral sim frame so it doesn't overlap existing
 * frames too obviously. Reuses FramesManager's own helper — simpler than
 * reimplementing the overlap-avoidance maths here.
 */
function nextFramePosition(
    editorEngine: ReturnType<typeof useEditorEngine>,
): { x: number; y: number } {
    const proposed: Frame = {
        id: 'proposed',
        canvasId: editorEngine.canvas.id,
        branchId: 'proposed',
        url: 'spectra://proposed',
        position: { x: 0, y: 0 },
        dimension: DEFAULT_DIMENSION,
    };
    return editorEngine.frames.calculateNonOverlappingPosition(proposed);
}
