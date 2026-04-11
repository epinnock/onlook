'use client';

import { useActiveProjectType } from '../editor-bar/hooks/use-project-type';
import { useEditorEngine } from '@/components/store/editor';
import { env } from '@/env';
import { usePreviewOnDevice } from '@/hooks/use-preview-on-device';
import { ProjectType, getSandboxPreviewUrl, SandboxTemplates, Templates } from '@onlook/constants';
import { Icons } from '@onlook/ui/icons';
import { Tooltip, TooltipContent, TooltipTrigger } from '@onlook/ui/tooltip';
import { observer } from 'mobx-react-lite';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';

export const ExpoQrButton = observer(() => {
    const projectType = useActiveProjectType();
    const editorEngine = useEditorEngine();
    const [showQr, setShowQr] = useState(false);
    const buttonRef = useRef<HTMLButtonElement>(null);

    // IMPORTANT: every hook below must be called UNCONDITIONALLY on every
    // render (rules-of-hooks). Project type / branch presence may flip
    // between renders during init; the early returns at the bottom keep
    // the hook order stable across all of those transitions.
    const frames = editorEngine.frames.getAll();
    const frameUrl = frames[0]?.frame?.url;
    const activeBranch = editorEngine.branches.activeBranch;
    const sandboxId = activeBranch?.sandbox?.id;
    const constructedUrl = sandboxId
        ? getSandboxPreviewUrl('code_sandbox', sandboxId, SandboxTemplates[Templates.EXPO_WEB].port)
        : '';
    const webUrl = frameUrl || constructedUrl;

    const sandbox = activeBranch ? editorEngine.branches.getSandboxById(activeBranch.id) : undefined;
    const tunnelUrl = sandbox?.expoTunnelUrl;

    // FOUND-Q3.4 follow-up (2026-04-08): wire the Wave H/Q Hermes flow into
    // the legacy ExpoQrButton so the existing UI affordance produces a real
    // Expo Go manifest URL instead of the canvas iframe URL. The hook drives
    // builder POST + poll + manifest-url construction; when ready, we render
    // the manifest URL in the QR. Falls back to tunnel/web URL if the
    // builder env vars aren't configured (preserves the legacy behavior).
    const fs = editorEngine.fileSystem;
    const projectId = editorEngine.projectId;
    const branchId = activeBranch?.id;
    const preview = usePreviewOnDevice({
        fs,
        projectId,
        branchId: branchId ?? '',
        builderBaseUrl: env.NEXT_PUBLIC_CF_ESM_BUILDER_URL,
        relayBaseUrl: env.NEXT_PUBLIC_CF_EXPO_RELAY_URL,
    });

    // Auto-trigger the build when the popup opens. Idempotent — the hook
    // returns immediately if a build is already in flight or completed.
    useEffect(() => {
        if (showQr && preview.status.kind === 'idle') {
            void preview.open();
        }
    }, [showQr, preview]);

    // Pick the BEST URL to encode in the QR. Priority order:
    //   1. Hermes manifest URL from the Wave H/Q flow (when builder is up)
    //   2. Legacy expo-cli tunnel URL (if a real `expo start --tunnel` is running)
    //   3. Canvas iframe URL (web preview, the original behavior)
    const manifestUrl =
        preview.status.kind === 'ready' ? preview.status.manifestUrl : null;
    const qrUrl = manifestUrl ?? tunnelUrl ?? webUrl;
    const hasExpoGoUrl = !!manifestUrl || !!tunnelUrl;
    const isBuilding =
        preview.status.kind === 'preparing' || preview.status.kind === 'building';
    const buildError =
        preview.status.kind === 'error' ? preview.status.message : null;

    // Early returns must come AFTER all hooks above so the hook order
    // stays stable across renders.
    if (projectType !== ProjectType.EXPO) {
        return null;
    }
    if (!qrUrl) {
        return null;
    }

    const handleCopy = (url: string, label: string) => {
        navigator.clipboard.writeText(url);
        toast.success(`${label} copied`);
    };

    // Calculate popup position from button
    const getPopupStyle = (): React.CSSProperties => {
        if (!buttonRef.current) return { display: 'none' };
        const rect = buttonRef.current.getBoundingClientRect();
        return {
            position: 'fixed',
            bottom: window.innerHeight - rect.top + 8,
            left: rect.left + rect.width / 2,
            transform: 'translateX(-50%)',
            zIndex: 9999,
        };
    };

    return (
        <>
            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        ref={buttonRef}
                        onClick={() => setShowQr(!showQr)}
                        className="h-9 w-9 flex items-center justify-center hover:text-foreground-hover text-foreground-tertiary hover:bg-accent/50 rounded-md border border-transparent"
                    >
                        <Icons.Smartphone className="w-4 h-4" />
                    </button>
                </TooltipTrigger>
                <TooltipContent sideOffset={5} hideArrow>Preview on Device</TooltipContent>
            </Tooltip>

            {showQr && createPortal(
                <>
                    {/* Backdrop to close on click outside */}
                    <div
                        className="fixed inset-0 z-[9998]"
                        onClick={() => setShowQr(false)}
                    />
                    <div
                        style={getPopupStyle()}
                        className="w-72 p-4 bg-background border border-border rounded-lg shadow-xl"
                    >
                        <div className="flex items-center justify-between mb-3">
                            <div className="flex items-center gap-2">
                                <Icons.Smartphone className="w-4 h-4 text-foreground-secondary" />
                                <span className="text-sm font-medium">Preview on Device</span>
                            </div>
                            <button
                                onClick={() => setShowQr(false)}
                                className="text-foreground-tertiary hover:text-foreground"
                            >
                                <Icons.CrossS className="w-3 h-3" />
                            </button>
                        </div>
                        <div className="flex flex-col gap-3">
                            <div className="flex items-center justify-center p-3 bg-white rounded-lg min-h-[180px] min-w-[180px]">
                                {isBuilding ? (
                                    <div className="flex flex-col items-center gap-2 text-foreground-tertiary text-xs text-center">
                                        <Icons.Reload className="w-5 h-5 animate-spin" />
                                        <span>Building Hermes bundle...</span>
                                        <span className="text-[10px]">~90s first time, instant on cache</span>
                                    </div>
                                ) : buildError ? (
                                    <div className="flex flex-col items-center gap-2 text-red-500 text-xs text-center px-2">
                                        <Icons.ExclamationTriangle className="w-5 h-5" />
                                        <span className="font-medium">Build failed</span>
                                        <span className="text-[10px] text-foreground-tertiary line-clamp-3">{buildError}</span>
                                        <button
                                            onClick={() => void preview.retry()}
                                            className="mt-1 px-2 py-1 text-[10px] bg-background-tertiary hover:bg-background-tertiary/80 rounded"
                                        >
                                            Retry
                                        </button>
                                    </div>
                                ) : (
                                    <img
                                        src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(qrUrl)}`}
                                        alt="QR Code"
                                        width={180}
                                        height={180}
                                    />
                                )}
                            </div>
                            <p className="text-xs text-foreground-tertiary text-center">
                                {hasExpoGoUrl
                                    ? 'Scan with Expo Go to preview natively (Hermes bundle)'
                                    : 'Scan to open web preview on your phone'
                                }
                            </p>

                            {manifestUrl && (
                                <button
                                    onClick={() => handleCopy(manifestUrl, 'Expo Go manifest URL')}
                                    className="flex items-center justify-center gap-2 px-3 py-1.5 text-xs bg-violet-500/10 hover:bg-violet-500/20 text-violet-400 rounded-md transition-colors"
                                >
                                    <Icons.ClipboardCopy className="w-3 h-3" />
                                    Copy Expo Go URL
                                </button>
                            )}

                            {tunnelUrl && !manifestUrl && (
                                <button
                                    onClick={() => handleCopy(tunnelUrl, 'Expo Go URL')}
                                    className="flex items-center justify-center gap-2 px-3 py-1.5 text-xs bg-violet-500/10 hover:bg-violet-500/20 text-violet-400 rounded-md transition-colors"
                                >
                                    <Icons.ClipboardCopy className="w-3 h-3" />
                                    Copy Expo Go URL
                                </button>
                            )}

                            <button
                                onClick={() => handleCopy(webUrl || qrUrl, 'Web URL')}
                                className="flex items-center justify-center gap-2 px-3 py-1.5 text-xs bg-background-tertiary hover:bg-background-tertiary/80 rounded-md transition-colors"
                            >
                                <Icons.ClipboardCopy className="w-3 h-3" />
                                Copy Web URL
                            </button>

                            <p className="text-[10px] text-foreground-tertiary truncate text-center select-all">
                                {qrUrl}
                            </p>
                        </div>
                    </div>
                </>,
                document.body,
            )}
        </>
    );
});
