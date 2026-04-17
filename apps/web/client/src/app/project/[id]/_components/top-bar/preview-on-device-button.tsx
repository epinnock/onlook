'use client';

/**
 * TQ3.3 — "Preview on device" button.
 *
 * Renders only when the active branch is an ExpoBrowser branch (the
 * Expo-Go-via-cf-esm-builder runtime). Clicking the button kicks off a
 * one-shot build via `usePreviewOnDevice` (TQ3.2) and opens a QR modal
 * (TQ3.1) that the user scans on a real device with Expo Go.
 *
 * The component intentionally returns `null` for non-ExpoBrowser branches
 * so the regular CodeSandbox/Cloudflare flows aren't cluttered with a
 * dead button. ExpoBrowser is detected via the persisted
 * `branch.sandbox.providerType` (set in branch settings, mirrored at
 * boot in `apps/web/client/src/components/store/editor/sandbox/session.ts`).
 *
 * The hook is invoked from a sub-component (`PreviewOnDeviceInner`) so
 * the Rules of Hooks aren't violated when we early-return `null` from
 * the outer observer for non-ExpoBrowser branches.
 */

import type { CodeFileSystem } from '@onlook/file-system';
import { useEditorEngine } from '@/components/store/editor';
import {
    QrModal,
    type SimulatorTabProps,
    type SimulatorTabStatus,
} from '@/components/ui/qr-modal';
import { env } from '@/env';
import { usePreviewOnDevice } from '@/hooks/use-preview-on-device';
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
            fs={editorEngine.fileSystem}
            projectId={editorEngine.projectId}
            branchId={activeBranch.id}
        />
    );
});

interface PreviewOnDeviceInnerProps {
    fs: CodeFileSystem;
    projectId: string;
    branchId: string;
}

function PreviewOnDeviceInner({
    fs,
    projectId,
    branchId,
}: PreviewOnDeviceInnerProps) {
    // Pass the Phase H/Q endpoints from @/env. In dev these point at the
    // local-builder-shim + local-relay-shim (port 8788/8787) over LAN IP;
    // in production they point at the deployed cf-esm-builder + cf-expo-relay
    // Worker URLs. When unset, the hook surfaces a clear error in the modal.
    const preview = usePreviewOnDevice({
        fs,
        projectId,
        branchId,
        builderBaseUrl: env.NEXT_PUBLIC_CF_ESM_BUILDER_URL,
        relayBaseUrl: env.NEXT_PUBLIC_CF_EXPO_RELAY_URL,
    });

    const browser = usePreviewInBrowser({
        fs,
        projectId,
        branchId,
        builderBaseUrl: env.NEXT_PUBLIC_CF_ESM_BUILDER_URL,
        relayBaseUrl: env.NEXT_PUBLIC_CF_EXPO_RELAY_URL,
    });

    const spectraEnabled = env.NEXT_PUBLIC_FEATURE_SPECTRA_PREVIEW;
    // Only query health when the flag is on — otherwise the endpoint throws
    // PRECONDITION_FAILED.
    const healthQuery = api.spectra.health.useQuery(undefined, {
        enabled: spectraEnabled,
        // Re-check every 30s while the modal is open so we notice if Spectra
        // goes down mid-session. tRPC will back off automatically on failure.
        refetchInterval: preview.isOpen ? 30_000 : false,
        // Don't retry on PRECONDITION_FAILED — the message is descriptive.
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

function toSimulatorTabStatus(status: ReturnType<typeof usePreviewInBrowser>['status']): SimulatorTabStatus {
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
