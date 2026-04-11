import { SystemTheme } from '@onlook/models/assets';
import { Icons } from '@onlook/ui/icons';
import { toast } from '@onlook/ui/sonner';
import { useEffect, useState } from 'react';
import { HoverOnlyTooltip } from '../hover-tooltip';
import { ToolbarButton } from '../toolbar-button';
import { type FrameData } from '@/components/store/editor/frames';

export function ThemeGroup({ frameData }: { frameData: FrameData }) {
    const [theme, setTheme] = useState<SystemTheme>(SystemTheme.SYSTEM);
    useEffect(() => {
        const getTheme = async () => {
            if (!frameData?.view) {
                // Benign: frame view is asynchronously created by FrameManager.
                // ThemeGroup's effect can run before it's ready on initial mount
                // or after IndexedDB cache clears. Demoted to debug so Next 16's
                // dev overlay doesn't surface a routine race as a Console Error.
                console.debug('[ThemeGroup] frame view not yet available, skipping theme fetch');
                return;
            }

            // ExpoBrowser branches use the SW preview iframe which doesn't
            // expose CSB's getTheme/setTheme penpal methods. The control is
            // a no-op in that mode — the canvas iframe's color scheme is
            // governed by the bundle's runtime, not by an editor toggle.
            if (typeof frameData.view.getTheme !== 'function') {
                console.debug('[ThemeGroup] view has no getTheme (browser-preview); skipping');
                return;
            }

            const theme = await frameData.view.getTheme();
            setTheme(theme);
        }
        void getTheme();
    }, [frameData]);

    async function changeTheme(newTheme: SystemTheme) {
        const previousTheme = theme;
        setTheme(newTheme);
        if (typeof frameData.view?.setTheme !== 'function') {
            // Same browser-preview gating as the read path above —
            // surface a friendly toast instead of a runtime crash.
            toast.error('Theme toggle not available in browser preview');
            setTheme(previousTheme);
            return;
        }
        const success = await frameData.view.setTheme(newTheme);
        if (!success) {
            toast.error('Failed to change theme');
            setTheme(previousTheme);
        }
    }

    return (
        <>
            <HoverOnlyTooltip content="System Theme" side="bottom" sideOffset={10}>
                    <ToolbarButton
                        className={`w-9 ${theme === SystemTheme.SYSTEM ? 'bg-background-tertiary/50 hover:bg-background-tertiary/50 text-foreground-primary' : 'hover:bg-background-tertiary/50 text-foreground-onlook'}`}
                        onClick={() => changeTheme(SystemTheme.SYSTEM)}
                    >
                        <Icons.Laptop className="h-4 w-4" />
                    </ToolbarButton>
            </HoverOnlyTooltip>
            <HoverOnlyTooltip content="Dark Theme" side="bottom" sideOffset={10}>
                    <ToolbarButton
                        className={`w-9 ${theme === SystemTheme.DARK ? 'bg-background-tertiary/50 hover:bg-background-tertiary/50 text-foreground-primary' : 'hover:bg-background-tertiary/50 text-foreground-onlook'}`}
                        onClick={() => changeTheme(SystemTheme.DARK)}
                    >
                        <Icons.Moon className="h-4 w-4" />
                    </ToolbarButton>
            </HoverOnlyTooltip>
            <HoverOnlyTooltip content="Light Theme" side="bottom" sideOffset={10}>
                    <ToolbarButton
                        className={`w-9 ${theme === SystemTheme.LIGHT ? 'bg-background-tertiary/50 hover:bg-background-tertiary/50 text-foreground-primary' : 'hover:bg-background-tertiary/50 text-foreground-onlook'}`}
                        onClick={() => changeTheme(SystemTheme.LIGHT)}
                    >
                        <Icons.Sun className="h-4 w-4" />
                    </ToolbarButton>
            </HoverOnlyTooltip>
        </>
    );
} 