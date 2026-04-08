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
import { QrModal } from '@/components/ui/qr-modal';
import { usePreviewOnDevice } from '@/hooks/use-preview-on-device';
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
    const preview = usePreviewOnDevice({ fs, projectId, branchId });

    const handleClick = () => {
        void preview.open();
    };

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
                onClose={preview.close}
                status={preview.status}
                onRetry={preview.retry}
            />
        </>
    );
}
