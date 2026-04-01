'use client';

import { useActiveProjectType } from '../editor-bar/hooks/use-project-type';
import { useEditorEngine } from '@/components/store/editor';
import { ProjectType } from '@onlook/constants';
import { Icons } from '@onlook/ui/icons';
import { Tooltip, TooltipContent, TooltipTrigger } from '@onlook/ui/tooltip';
import { observer } from 'mobx-react-lite';
import { useState } from 'react';
import { toast } from 'sonner';

export const ExpoQrButton = observer(() => {
    const projectType = useActiveProjectType();
    const editorEngine = useEditorEngine();
    const [showQr, setShowQr] = useState(false);

    if (projectType !== ProjectType.EXPO) {
        return null;
    }

    const frames = editorEngine.frames.getAll();
    const activeFrame = frames[0];
    const previewUrl = activeFrame?.frame?.url || '';

    const handleCopy = () => {
        if (previewUrl) {
            navigator.clipboard.writeText(previewUrl);
            toast.success('URL copied to clipboard');
        }
    };

    return (
        <div className="relative">
            <Tooltip>
                <TooltipTrigger asChild>
                    <button
                        onClick={() => setShowQr(!showQr)}
                        className="h-9 w-9 flex items-center justify-center hover:text-foreground-hover text-foreground-tertiary hover:bg-accent/50 rounded-md border border-transparent"
                    >
                        <Icons.Smartphone className="w-4 h-4" />
                    </button>
                </TooltipTrigger>
                <TooltipContent sideOffset={5} hideArrow>Preview on Device</TooltipContent>
            </Tooltip>
            {showQr && (
                <div className="absolute bottom-12 left-1/2 -translate-x-1/2 w-64 p-4 bg-background border border-border rounded-lg shadow-xl z-50">
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
                    {previewUrl ? (
                        <div className="flex flex-col gap-3">
                            <div className="flex items-center justify-center p-3 bg-white rounded-lg">
                                <img
                                    src={`https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(previewUrl)}`}
                                    alt="QR Code"
                                    width={180}
                                    height={180}
                                />
                            </div>
                            <p className="text-xs text-foreground-tertiary text-center">
                                Scan to open web preview on your phone
                            </p>
                            <button
                                onClick={handleCopy}
                                className="flex items-center justify-center gap-2 px-3 py-1.5 text-xs bg-background-tertiary hover:bg-background-tertiary/80 rounded-md transition-colors"
                            >
                                <Icons.ClipboardCopy className="w-3 h-3" />
                                Copy URL
                            </button>
                        </div>
                    ) : (
                        <p className="text-xs text-foreground-tertiary text-center py-4">
                            Waiting for sandbox to start...
                        </p>
                    )}
                </div>
            )}
        </div>
    );
});
