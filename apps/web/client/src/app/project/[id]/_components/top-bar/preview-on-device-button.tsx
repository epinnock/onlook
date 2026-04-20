'use client';

/**
 * "Preview on device" button.
 *
 * Renders only when the active branch is an ExpoBrowser branch. The modal
 * gives the user two ways to preview:
 *
 * - **On device (QR)** — polls the mobile-preview server's `/status`
 *   endpoint and renders a QR pointing at the pre-staged static runtime
 *   bundle. Component edits flow over the WebSocket eval channel on the
 *   same server (wired separately).
 *
 * - **In browser (simulator)** — behind the
 *   `NEXT_PUBLIC_FEATURE_SPECTRA_PREVIEW` flag, runs a full cf-esm-builder
 *   build, provisions a Spectra-managed iOS simulator, and drops an
 *   ephemeral simulator frame onto the canvas streaming the live MJPEG.
 *
 * The component intentionally returns `null` for non-ExpoBrowser branches
 * so the regular CodeSandbox/Cloudflare flows aren't cluttered with a
 * dead button. The inner hook is invoked from a sub-component so the
 * Rules of Hooks aren't violated when we early-return `null`.
 */

import type { CodeFileSystem } from '@onlook/file-system';
import { useEditorEngine } from '@/components/store/editor';
import {
    QrModal,
    type SimulatorTabProps,
    type SimulatorTabStatus,
} from '@/components/ui/qr-modal';
import { env } from '@/env';
import { useMobilePreviewStatus } from '@/hooks/use-mobile-preview-status';
import { usePreviewInBrowser } from '@/hooks/use-preview-in-browser';
import { api } from '@/trpc/react';
import { Button } from '@onlook/ui/button';
import { observer } from 'mobx-react-lite';

export const PreviewOnDeviceButton = observer(function PreviewOnDeviceButton() {
    const editorEngine = useEditorEngine();
    const activeBranch = editorEngine.branches.activeBranch;
    const isExpoBrowser = activeBranch?.sandbox?.providerType === 'expo_browser';

    if (!isExpoBrowser || !activeBranch) {
        return null;
    }

    return (
        <PreviewOnDeviceInner
            fileSystem={editorEngine.fileSystem}
            projectId={editorEngine.projectId}
            branchId={activeBranch.id}
        />
    );
});

interface PreviewOnDeviceInnerProps {
    fileSystem: CodeFileSystem;
    projectId: string;
    branchId: string;
}

function PreviewOnDeviceInner({
    fileSystem,
    projectId,
    branchId,
}: PreviewOnDeviceInnerProps) {
    // On-device QR flow — new mobile-preview-shim static-runtime path.
    const preview = useMobilePreviewStatus({
        serverBaseUrl: env.NEXT_PUBLIC_MOBILE_PREVIEW_URL,
        fileSystem,
    });

    // Inline simulator flow — cf-esm-builder + Spectra. Gated by the
    // feature flag; the hook short-circuits into an error state if the
    // flag is off.
    const browser = usePreviewInBrowser({
        fs: fileSystem,
        projectId,
        branchId,
        builderBaseUrl: env.NEXT_PUBLIC_CF_ESM_BUILDER_URL,
        relayBaseUrl: env.NEXT_PUBLIC_CF_EXPO_RELAY_URL,
    });

    const spectraEnabled = env.NEXT_PUBLIC_FEATURE_SPECTRA_PREVIEW;
    // Only query health when the flag is on — otherwise the endpoint
    // throws PRECONDITION_FAILED.
    const healthQuery = api.spectra.health.useQuery(undefined, {
        enabled: spectraEnabled,
        refetchInterval: preview.isOpen ? 30_000 : false,
        retry: false,
    });

    const handleClick = () => {
        void preview.open();
    };

    const handleClose = () => {
        preview.close();
        void browser.close();
    };

    const simulator: SimulatorTabProps | undefined = spectraEnabled
        ? {
              status: toSimulatorTabStatus(browser.status),
              onLaunch: () => void browser.open(),
              onRetry: () => void browser.retry(),
              healthy: healthQuery.data?.healthy ?? false,
          }
        : undefined;

    return (
        <>
            <Button
                variant="ghost"
                size="sm"
                className="h-8"
                onClick={handleClick}
                data-testid="preview-on-device-button"
                aria-label="Preview on device"
            >
                Preview on device
            </Button>
            <QrModal
                open={preview.isOpen}
                onClose={handleClose}
                status={preview.status}
                onRetry={preview.retry}
                simulator={simulator}
            />
        </>
    );
}

function toSimulatorTabStatus(
    status: ReturnType<typeof usePreviewInBrowser>['status'],
): SimulatorTabStatus {
    switch (status.kind) {
        case 'idle':
        case 'building':
        case 'launching':
        case 'error':
            return status;
        case 'ready':
            return { kind: 'ready', sessionId: status.sessionId };
    }
}
