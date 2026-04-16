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

import { useEditorEngine } from '@/components/store/editor';
import { MobilePreviewErrorPanel } from '@/components/ui/mobile-preview-error-panel';
import { QrModal } from '@/components/ui/qr-modal';
import { env } from '@/env';
import {
    useMobilePreviewConnection,
    type MobilePreviewConnectionStatus,
} from '@/hooks/use-mobile-preview-connection';
import { useMobilePreviewStatus } from '@/hooks/use-mobile-preview-status';
import { Button } from '@onlook/ui/button';
import { observer } from 'mobx-react-lite';

export const PreviewOnDeviceButton = observer(function PreviewOnDeviceButton() {
    const editorEngine = useEditorEngine();
    const activeBranch = editorEngine.branches.activeBranch;
    const isExpoBrowser = activeBranch?.sandbox?.providerType === 'expo_browser';

    if (!isExpoBrowser || !activeBranch) {
        return null;
    }

    return <PreviewOnDeviceInner fileSystem={editorEngine.fileSystem} />;
});

function PreviewOnDeviceInner({
    fileSystem,
}: {
    fileSystem: ReturnType<typeof useEditorEngine>['fileSystem'];
}) {
    const connection = useMobilePreviewConnection({
        serverBaseUrl: env.NEXT_PUBLIC_MOBILE_PREVIEW_URL,
    });
    // Browser-only mobile preview: hits the mobile-preview server's
    // /status endpoint to fetch the pre-staged static runtime manifest URL.
    // In dev this points at packages/mobile-preview/server (port 8787) over
    // LAN IP; in production it points at the deployed CF Worker that serves
    // the static runtime manifest. When unset, the hook surfaces a clear
    // error in the modal.
    const preview = useMobilePreviewStatus({
        serverBaseUrl: env.NEXT_PUBLIC_MOBILE_PREVIEW_URL,
        fileSystem,
    });

    const handleClick = () => {
        void preview.open();
    };

    return (
        <>
            <div className="flex flex-col items-start gap-2">
                <div className="flex items-center gap-2">
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
                    <span
                        data-testid="mobile-preview-connection-status"
                        data-status={connection.status.kind}
                        className={getConnectionStatusClassName(connection.status)}
                        aria-live="polite"
                    >
                        {getConnectionStatusLabel(connection.status)}
                    </span>
                </div>
                <MobilePreviewErrorPanel panel={preview.errorPanel} />
            </div>
            <QrModal
                open={preview.isOpen}
                onClose={preview.close}
                status={preview.status}
                onRetry={preview.retry}
            />
        </>
    );
}

function getConnectionStatusClassName(status: MobilePreviewConnectionStatus): string {
    const baseClassName =
        'inline-flex h-8 items-center rounded-full border px-2 text-xs font-medium';

    switch (status.kind) {
        case 'connected':
            return `${baseClassName} border-emerald-500/30 bg-emerald-500/10 text-emerald-300`;
        case 'checking':
            return `${baseClassName} border-amber-500/30 bg-amber-500/10 text-amber-300`;
        case 'waiting':
            return `${baseClassName} border-zinc-500/30 bg-zinc-500/10 text-zinc-300`;
        case 'error':
            return `${baseClassName} border-red-500/30 bg-red-500/10 text-red-300`;
        case 'disabled':
            return `${baseClassName} border-zinc-600/30 bg-zinc-600/10 text-zinc-400`;
    }
}

function getConnectionStatusLabel(status: MobilePreviewConnectionStatus): string {
    switch (status.kind) {
        case 'connected':
            return `${status.clients} ${status.clients === 1 ? 'device' : 'devices'}`;
        case 'checking':
            return 'Checking';
        case 'waiting':
            return status.hasRuntime ? '0 devices' : 'Starting runtime';
        case 'error':
            return 'Server offline';
        case 'disabled':
            return 'Preview unavailable';
    }
}
