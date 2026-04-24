'use client';

/**
 * "Preview on device" button.
 *
 * Renders only when the active branch is an ExpoBrowser branch. Clicking
 * the button polls the mobile-preview server's `/status` endpoint and
 * opens a QR modal pointing at the pre-staged static runtime bundle.
 * Component edits flow over the WebSocket eval channel on the same server
 * (wired separately) — no per-click build pipeline.
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

import { InstallStatusIndicator } from '@/components/editor/install-status/InstallStatusIndicator';
import { useEditorEngine } from '@/components/store/editor';
import { QrModal } from '@/components/ui/qr-modal';
import { env } from '@/env';
import { useInstallDependencies } from '@/hooks/use-install-dependencies';
import { useMobilePreviewStatus } from '@/hooks/use-mobile-preview-status';
import { createProviderInstallClient } from '@/services/mobile-preview/provider-install-client';
import { Button } from '@onlook/ui/button';
import { observer } from 'mobx-react-lite';
import { useMemo } from 'react';

export const PreviewOnDeviceButton = observer(function PreviewOnDeviceButton() {
    const editorEngine = useEditorEngine();
    const activeBranch = editorEngine.branches.activeBranch;
    const isExpoBrowser = activeBranch?.sandbox?.providerType === 'expo_browser';

    if (!isExpoBrowser || !activeBranch) {
        return null;
    }

    return <PreviewOnDeviceInner fileSystem={editorEngine.fileSystem} />;
});

const PreviewOnDeviceInner = observer(function PreviewOnDeviceInner({
    fileSystem,
}: {
    fileSystem: ReturnType<typeof useEditorEngine>['fileSystem'];
}) {
    // Browser-only mobile preview: hits the mobile-preview server's
    // /status endpoint to fetch the pre-staged static runtime manifest URL.
    // In dev this points at packages/mobile-preview/server (port 8787) over
    // LAN IP; in production it points at the deployed CF Worker that serves
    // the static runtime manifest. When unset, the hook surfaces a clear
    // error in the modal.
    const editorEngine = useEditorEngine();
    const preview = useMobilePreviewStatus({
        serverBaseUrl: env.NEXT_PUBLIC_MOBILE_PREVIEW_URL,
        fileSystem,
    });

    const provider = editorEngine.activeSandbox.session.provider;
    const installClient = useMemo(
        () => (provider ? createProviderInstallClient({ provider }) : null),
        [provider],
    );
    const { status: installStatus, cancel: cancelInstall } = useInstallDependencies({
        fileSystem,
        client: installClient,
    });

    const handleClick = () => {
        void preview.open();
    };

    return (
        <>
            <InstallStatusIndicator
                status={installStatus}
                onCancel={cancelInstall}
                className="h-8"
            />
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
                onClose={preview.close}
                status={preview.status}
                onRetry={preview.retry}
            />
        </>
    );
});
