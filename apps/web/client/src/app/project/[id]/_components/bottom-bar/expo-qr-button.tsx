'use client';

import { useActiveProjectType } from '../editor-bar/hooks/use-project-type';
import { useEditorEngine } from '@/components/store/editor';
import { ProjectType, getSandboxPreviewUrl, SandboxTemplates, Templates } from '@onlook/constants';
import { Icons } from '@onlook/ui/icons';
import { Tooltip, TooltipContent, TooltipTrigger } from '@onlook/ui/tooltip';
import { observer } from 'mobx-react-lite';
import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'sonner';

export const ExpoQrButton = observer(() => {
    const projectType = useActiveProjectType();
    const editorEngine = useEditorEngine();
    const [showQr, setShowQr] = useState(false);
    const buttonRef = useRef<HTMLButtonElement>(null);

    if (projectType !== ProjectType.EXPO) {
        return null;
    }

    const frames = editorEngine.frames.getAll();
    const frameUrl = frames[0]?.frame?.url;
    const activeBranch = editorEngine.branches.activeBranch;
    const sandboxId = activeBranch?.sandbox?.id;
    const constructedUrl = sandboxId
        ? getSandboxPreviewUrl(sandboxId, SandboxTemplates[Templates.EXPO_WEB].port)
        : '';
    const webUrl = frameUrl || constructedUrl;

    const sandbox = editorEngine.branches.getSandboxById(activeBranch.id);
    const tunnelUrl = sandbox?.expoTunnelUrl;
    const qrUrl = tunnelUrl || webUrl;
    const hasExpoGoUrl = !!tunnelUrl;

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
                            <div className="flex items-center justify-center p-3 bg-white rounded-lg">
                                <img
                                    src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(qrUrl)}`}
                                    alt="QR Code"
                                    width={180}
                                    height={180}
                                />
                            </div>
                            <p className="text-xs text-foreground-tertiary text-center">
                                {hasExpoGoUrl
                                    ? 'Scan with Expo Go to preview natively'
                                    : 'Scan to open web preview on your phone'
                                }
                            </p>

                            {tunnelUrl && (
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
