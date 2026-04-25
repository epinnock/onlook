'use client';

import { useState } from 'react';
import { observer } from 'mobx-react-lite';
import { motion } from 'motion/react';

import { Icons } from '@onlook/ui/icons';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@onlook/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@onlook/ui/tooltip';
import { cn } from '@onlook/ui/utils';

import { MobilePreviewDevPanelContainer } from '@/components/editor/dev-panel/MobilePreviewDevPanelContainer';
import { useEditorEngine } from '@/components/store/editor';
import { env } from '@/env';
import { ExpoQrButton } from './expo-qr-button';
import { RestartSandboxButton } from './restart-sandbox-button';
import { Terminal } from './terminal';

const MOBILE_PREVIEW_TAB_KEY = '__mobile-preview__';

export const TerminalArea = observer(({ children }: { children: React.ReactNode }) => {
    const editorEngine = useEditorEngine();
    const branches = editorEngine.branches;

    // Phase 9 #51 UI wire-in: mobile-preview dev panel appears as a
    // synthetic tab whenever any branch uses the ExpoBrowser provider.
    // The panel surface is provider-agnostic, but gating on ExpoBrowser
    // keeps the tab out of the way for CSB/Cloudflare-only projects.
    const hasExpoBrowserBranch = branches.allBranches.some(
        (b) => b?.sandbox?.providerType === 'expo_browser',
    );

    // Collect terminal sessions from all branches
    const allTerminalSessions = new Map<
        string,
        { name: string; branchName: string; branchId: string; sessionId: string; session: any }
    >();
    let activeSessionId: string | null = null;

    for (const branch of branches.allBranches) {
        try {
            const branchData = branches.getBranchById(branch.id);
            if (!branchData) continue;

            // Get the sandbox manager for this branch
            const sandbox = branches.getSandboxById(branch.id);
            if (!sandbox?.session?.terminalSessions) continue;

            for (const [sessionId, session] of sandbox.session.terminalSessions) {
                const key = `${branch.id}-${sessionId}`;
                allTerminalSessions.set(key, {
                    name: session.name,
                    branchName: branch.name,
                    branchId: branch.id,
                    sessionId: sessionId,
                    session: session,
                });

                // Set active session if this is the currently active branch and session
                if (
                    branch.id === branches.activeBranch.id &&
                    sessionId === sandbox.session.activeTerminalSessionId
                ) {
                    activeSessionId = key;
                }
            }
        } catch (error) {
            // Skip branches that aren't properly initialized
            continue;
        }
    }

    const [terminalHidden, setTerminalHidden] = useState(true);

    return (
        <>
            {terminalHidden ? (
                <motion.div layout className="flex items-center gap-1">
                    {children}
                    <ExpoQrButton />
                    <RestartSandboxButton />
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <button
                                onClick={() => setTerminalHidden(!terminalHidden)}
                                className="hover:text-foreground-hover text-foreground-tertiary hover:bg-accent/50 flex h-9 w-9 items-center justify-center rounded-md border border-transparent"
                            >
                                <Icons.Terminal />
                            </button>
                        </TooltipTrigger>
                        <TooltipContent sideOffset={5} hideArrow>
                            Toggle Terminal
                        </TooltipContent>
                    </Tooltip>
                </motion.div>
            ) : (
                <motion.div layout className="mb-1 flex w-full items-center justify-between">
                    <motion.span
                        initial={{ opacity: 0, x: 10 }}
                        animate={{ opacity: 1, x: 0 }}
                        exit={{ opacity: 0, x: -10 }}
                        transition={{ duration: 0.7 }}
                        className="text-small text-foreground-secondary ml-2 select-none"
                    >
                        Terminal
                    </motion.span>
                    <div className="flex items-center gap-1">
                        <motion.div layout>{/* <RunButton /> */}</motion.div>
                        <ExpoQrButton />
                        <RestartSandboxButton />
                        <Tooltip>
                            <TooltipTrigger asChild>
                                <button
                                    onClick={() => setTerminalHidden(!terminalHidden)}
                                    className="hover:text-foreground-hover text-foreground-tertiary hover:bg-accent/50 flex h-9 w-9 items-center justify-center rounded-md border border-transparent"
                                >
                                    <Icons.ChevronDown />
                                </button>
                            </TooltipTrigger>
                            <TooltipContent sideOffset={5} hideArrow>
                                Toggle Terminal
                            </TooltipContent>
                        </Tooltip>
                    </div>
                </motion.div>
            )}
            <div
                className={cn(
                    'bg-background flex h-full flex-col items-center justify-between overflow-auto rounded-lg transition-all duration-300',
                    terminalHidden ? 'invisible h-0 w-0' : 'h-[22rem] w-[37rem]',
                )}
            >
                {allTerminalSessions.size > 0 || hasExpoBrowserBranch ? (
                    <Tabs
                        defaultValue={'cli'}
                        value={activeSessionId || ''}
                        onValueChange={(value) => {
                            if (value === MOBILE_PREVIEW_TAB_KEY) {
                                return;
                            }
                            // Extract branch and session from the combined key
                            const terminalData = allTerminalSessions.get(value);
                            if (terminalData) {
                                // Switch to the branch first
                                editorEngine.branches.switchToBranch(terminalData.branchId);
                                // Then set the active terminal session for that branch
                                const sandbox = branches.getSandboxById(terminalData.branchId);
                                if (sandbox) {
                                    sandbox.session.activeTerminalSessionId =
                                        terminalData.sessionId;
                                }
                            }
                        }}
                        className="h-full w-full"
                    >
                        <TabsList className="border-border h-8 w-full justify-start overflow-x-auto rounded-none border-b">
                            {Array.from(allTerminalSessions).map(([key, terminalData]) => (
                                <TabsTrigger key={key} value={key} className="flex-1">
                                    <span className="truncate">
                                        {terminalData.name} • {terminalData.branchName}
                                    </span>
                                </TabsTrigger>
                            ))}
                            {hasExpoBrowserBranch ? (
                                <TabsTrigger
                                    key={MOBILE_PREVIEW_TAB_KEY}
                                    value={MOBILE_PREVIEW_TAB_KEY}
                                    className="flex-1"
                                    data-testid="terminal-area-mobile-preview-tab"
                                >
                                    <span className="truncate">Mobile Preview</span>
                                </TabsTrigger>
                            ) : null}
                        </TabsList>
                        <div className="h-full w-full overflow-auto">
                            {Array.from(allTerminalSessions).map(([key, terminalData]) => (
                                <TabsContent
                                    key={key}
                                    forceMount
                                    value={key}
                                    className="h-full"
                                    hidden={activeSessionId !== key}
                                >
                                    <Terminal
                                        hidden={terminalHidden}
                                        terminalSessionId={terminalData.sessionId}
                                        branchId={terminalData.branchId}
                                    />
                                </TabsContent>
                            ))}
                            {hasExpoBrowserBranch ? (
                                <TabsContent
                                    key={MOBILE_PREVIEW_TAB_KEY}
                                    value={MOBILE_PREVIEW_TAB_KEY}
                                    className="h-full"
                                >
                                    <MobilePreviewDevPanelContainer
                                        serverBaseUrl={env.NEXT_PUBLIC_MOBILE_PREVIEW_URL}
                                        fileSystem={editorEngine.fileSystem}
                                        defaultTab="console"
                                    />
                                </TabsContent>
                            ) : null}
                        </div>
                    </Tabs>
                ) : (
                    <div className="text-muted-foreground flex h-full items-center justify-center">
                        <span className="text-sm">No terminal sessions available</span>
                    </div>
                )}
            </div>
        </>
    );
});
