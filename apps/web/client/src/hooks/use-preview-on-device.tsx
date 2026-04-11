'use client';

/**
 * usePreviewOnDevice (TQ3.2).
 *
 * Orchestrates the "Preview on device" flow by gluing together:
 *   1. `BuildOrchestrator.build()` — tars the workspace FS and drives
 *      cf-esm-builder to a terminal state (TH4.4).
 *   2. `buildManifestUrl(bundleHash, relayBaseUrl)` — turns the
 *      resulting `bundleHash` into the URL Expo Go scans (TQ2.3).
 *   3. `renderQrSvg(url)` — renders the QR SVG string (TQ2.2).
 *
 * The resulting `{ status, isOpen, open, close, retry }` tuple is
 * consumed by the QrModal (TQ3.1) + the toolbar button (TQ3.3).
 */

import { useCallback, useRef, useState } from 'react';

import type { CodeFileSystem } from '@onlook/file-system';

import {
    BuilderClient,
    BuildOrchestrator,
    type BuildStatus,
} from '@/services/expo-builder';
import { buildManifestUrl, renderQrSvg } from '@/services/expo-relay';

import type { QrModalStatus } from '@/components/ui/qr-modal';

/**
 * Factory seams — exposed so tests can swap in stubs without having to
 * go through `mock.module`. Production callers should never set these.
 */
export interface UsePreviewOnDeviceDeps {
    createBuilderClient?: (baseUrl: string) => BuilderClient;
    createOrchestrator?: (args: {
        client: BuilderClient;
        fs: CodeFileSystem;
        projectId: string;
        branchId: string;
    }) => Pick<BuildOrchestrator, 'build' | 'dispose'>;
    buildManifestUrl?: typeof buildManifestUrl;
    renderQrSvg?: typeof renderQrSvg;
}

export interface UsePreviewOnDeviceOptions {
    fs: CodeFileSystem;
    projectId: string;
    branchId: string;
    /**
     * Base URL of cf-esm-builder. Required — callers should source this
     * from `@/env` (e.g. `NEXT_PUBLIC_CF_ESM_BUILDER_URL` once TQ3.4 adds
     * it to the validated env schema). Passing an empty string triggers
     * a config-error state in `open()`.
     */
    builderBaseUrl?: string;
    /**
     * Base URL of cf-expo-relay. Required — same sourcing rules as
     * `builderBaseUrl`.
     */
    relayBaseUrl?: string;
    /** Test seams — unused in production. */
    deps?: UsePreviewOnDeviceDeps;
}

export interface UsePreviewOnDeviceResult {
    status: QrModalStatus;
    isOpen: boolean;
    open: () => Promise<void>;
    close: () => void;
    retry: () => Promise<void>;
}

/** Thrown when a required URL is missing and no env fallback is set. */
export class PreviewOnDeviceConfigError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'PreviewOnDeviceConfigError';
    }
}

function nonEmpty(value: string | undefined): string | undefined {
    return value && value.length > 0 ? value : undefined;
}

/**
 * One-shot orchestration: tar → build → manifest URL → QR. Exported
 * (without React) so unit tests can exercise the state machine directly
 * without needing a React renderer.
 */
export async function runPreviewOnDevice(args: {
    fs: CodeFileSystem;
    projectId: string;
    branchId: string;
    builderBaseUrl: string;
    relayBaseUrl: string;
    setStatus: (status: QrModalStatus) => void;
    deps?: UsePreviewOnDeviceDeps;
    orchestratorRef?: {
        current: Pick<BuildOrchestrator, 'build' | 'dispose'> | null;
    };
}): Promise<void> {
    const {
        fs,
        projectId,
        branchId,
        builderBaseUrl,
        relayBaseUrl,
        setStatus,
        deps,
        orchestratorRef,
    } = args;

    try {
        setStatus({ kind: 'preparing' });

        const clientFactory =
            deps?.createBuilderClient ??
            ((baseUrl: string) => new BuilderClient({ baseUrl }));
        const orchestratorFactory =
            deps?.createOrchestrator ??
            (({ client, fs: innerFs, projectId: pid, branchId: bid }) =>
                new BuildOrchestrator({
                    client,
                    fs: innerFs,
                    projectId: pid,
                    branchId: bid,
                }));
        const manifestUrlBuilder = deps?.buildManifestUrl ?? buildManifestUrl;
        const qrRenderer = deps?.renderQrSvg ?? renderQrSvg;

        const client = clientFactory(builderBaseUrl);
        const orchestrator = orchestratorFactory({
            client,
            fs,
            projectId,
            branchId,
        });
        if (orchestratorRef) {
            orchestratorRef.current?.dispose();
            orchestratorRef.current = orchestrator;
        }

        setStatus({ kind: 'building' });
        const result: BuildStatus = await orchestrator.build();

        if (result.state !== 'ready' || !result.bundleHash) {
            const message =
                result.error ??
                `Build finished in state=${result.state} without a bundleHash`;
            setStatus({ kind: 'error', message });
            return;
        }

        const manifestUrl = manifestUrlBuilder(result.bundleHash, {
            relayBaseUrl,
        });
        const qrSvg = await qrRenderer(manifestUrl);

        setStatus({ kind: 'ready', manifestUrl, qrSvg });
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        setStatus({ kind: 'error', message });
    }
}

export function usePreviewOnDevice(
    opts: UsePreviewOnDeviceOptions,
): UsePreviewOnDeviceResult {
    const [status, setStatus] = useState<QrModalStatus>({ kind: 'idle' });
    const [isOpen, setIsOpen] = useState(false);
    const orchestratorRef = useRef<Pick<
        BuildOrchestrator,
        'build' | 'dispose'
    > | null>(null);

    const open = useCallback(async () => {
        const builderBaseUrl = nonEmpty(opts.builderBaseUrl);
        const relayBaseUrl = nonEmpty(opts.relayBaseUrl);

        setIsOpen(true);

        if (!builderBaseUrl) {
            setStatus({
                kind: 'error',
                message:
                    'Missing builder base URL — pass `builderBaseUrl` (e.g. from @/env).',
            });
            return;
        }
        if (!relayBaseUrl) {
            setStatus({
                kind: 'error',
                message:
                    'Missing relay base URL — pass `relayBaseUrl` (e.g. from @/env).',
            });
            return;
        }

        await runPreviewOnDevice({
            fs: opts.fs,
            projectId: opts.projectId,
            branchId: opts.branchId,
            builderBaseUrl,
            relayBaseUrl,
            setStatus,
            deps: opts.deps,
            orchestratorRef,
        });
    }, [
        opts.fs,
        opts.projectId,
        opts.branchId,
        opts.builderBaseUrl,
        opts.relayBaseUrl,
        opts.deps,
    ]);

    const close = useCallback(() => {
        setIsOpen(false);
        setStatus({ kind: 'idle' });
        orchestratorRef.current?.dispose();
        orchestratorRef.current = null;
    }, []);

    const retry = useCallback(async () => {
        await open();
    }, [open]);

    return { status, isOpen, open, close, retry };
}
