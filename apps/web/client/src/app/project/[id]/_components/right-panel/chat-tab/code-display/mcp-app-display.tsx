'use client';

import { McpAppBridge } from '@/components/store/editor/chat/mcp-app-bridge';
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from '@onlook/ui/alert-dialog';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@onlook/ui/collapsible';
import { Icons } from '@onlook/ui/icons';
import { cn } from '@onlook/ui/utils';
import type { ToolUIPart } from 'ai';
import { AnimatePresence, motion } from 'motion/react';
import { memo, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { McpAppSandbox } from './mcp-app-sandbox';
import { type McpAppUiMeta, parseMcpToolName, resolveUiResourceUri } from './mcp-app-utils';

interface McpAppDisplayProps {
    toolPart: ToolUIPart;
    uiMeta: McpAppUiMeta;
    messageId: string;
}

type LoadState = 'loading' | 'loaded' | 'error';

// Global postMessage spy — installed once, logs all JSON-RPC messages
let globalSpyInstalled = false;
function installGlobalPostMessageSpy() {
    if (globalSpyInstalled) return;
    globalSpyInstalled = true;
    window.addEventListener('message', (e) => {
        if (e.data?.jsonrpc === '2.0') {
            console.log(`[MCP postmessage/GLOBAL] method=${e.data.method || 'response'} id=${e.data.id} origin=${e.origin} sourceIsWindow=${e.source === window}`);
        }
    });
    console.log(`[MCP postmessage/GLOBAL] Global spy installed`);
}

const McpAppDisplayComponent = ({ toolPart, uiMeta, messageId }: McpAppDisplayProps) => {
    // Install global spy on first render
    if (typeof window !== 'undefined') installGlobalPostMessageSpy();

    const [isOpen, setIsOpen] = useState(true);
    const [loadState, setLoadState] = useState<LoadState>('loading');
    const [htmlContent, setHtmlContent] = useState<string>('');
    const [consentRequest, setConsentRequest] = useState<{
        requestId: string | number;
        toolName: string;
        args: unknown;
    } | null>(null);

    const iframeRef = useRef<HTMLIFrameElement>(null);
    const bridgeRef = useRef<McpAppBridge | null>(null);

    const parsed = parseMcpToolName(toolPart.type.split('-')[1] ?? '');
    const displayName = parsed
        ? `${parsed.serverName} / ${parsed.originalToolName}`
        : uiMeta.title ?? 'MCP App';

    // Extract mcpServerUrl from tool output for resolving ui:// resource URIs
    const mcpServerUrl = (() => {
        const output = toolPart.output as Record<string, unknown> | null;
        if (!output) return undefined;
        const raw = (output.type === 'json' && output.value && typeof output.value === 'object')
            ? output.value as Record<string, unknown>
            : output;
        return typeof raw.mcpServerUrl === 'string' ? raw.mcpServerUrl : undefined;
    })();

    // Fetch the UI resource HTML
    useEffect(() => {
        const fetchResource = async () => {
            try {
                const resolvedUrl = resolveUiResourceUri(uiMeta.resourceUri, mcpServerUrl);
                console.log(`[MCP resource-load/client] Fetching widget: ${uiMeta.resourceUri} → ${resolvedUrl}`);
                // Proxy through our own server to avoid CORS issues with cross-origin MCP servers
                const proxyUrl = `/api/mcp/proxy-resource?url=${encodeURIComponent(resolvedUrl)}`;
                console.log(`[MCP resource-load/client] Proxy URL: ${proxyUrl}`);
                const response = await fetch(proxyUrl);
                if (!response.ok) {
                    throw new Error(`Failed to fetch MCP App resource: ${response.status}`);
                }
                const html = await response.text();
                console.log(`[MCP resource-load/client] Widget HTML loaded: ${html.length} bytes`);
                setHtmlContent(html);
                setLoadState('loaded');
            } catch (err) {
                console.error('[MCP resource-load/client] Failed to load resource:', err);
                setLoadState('error');
            }
        };

        void fetchResource();
    }, [uiMeta.resourceUri, mcpServerUrl]);

    // Two-phase bridge setup:
    // Phase 1: Start listening globally (no iframe needed).
    // Phase 2: Once listening, set bridgeReady=true so the iframe renders.
    // When the iframe renders with srcdoc, its scripts run and send ui/initialize.
    // The bridge is already listening so it catches the message.
    //
    // The bridge is NOT cleaned up on Strict Mode unmount — it must persist
    // because the srcdoc iframe's script only runs once on first DOM insertion.
    const [bridgeReady, setBridgeReady] = useState(false);

    useEffect(() => {
        if (loadState !== 'loaded') return;
        if (bridgeRef.current) {
            console.log(`[MCP bridge-setup/client] Bridge already exists (Strict Mode remount), re-signaling ready`);
            setBridgeReady(true);
            return;
        }

        console.log(`[MCP bridge-setup/client] Creating bridge and connectGlobal()`);
        const bridge = new McpAppBridge(toolPart.output);
        bridge.connectGlobal();
        bridgeRef.current = bridge;
        console.log(`[MCP bridge-setup/client] Bridge created, setting bridgeReady=true`);
        setBridgeReady(true);

        // NO cleanup — bridge must survive Strict Mode double-mount
    }, [loadState, toolPart.output]);

    // Bind iframe to bridge once it renders
    useEffect(() => {
        console.log(`[MCP bridge-setup/client] bindIframe effect: bridgeReady=${bridgeReady} iframeRef=${!!iframeRef.current} bridgeRef=${!!bridgeRef.current}`);
        if (bridgeReady && iframeRef.current && bridgeRef.current) {
            console.log(`[MCP bridge-setup/client] Binding iframe to bridge`);
            bridgeRef.current.bindIframe(iframeRef.current);
        }
    }, [bridgeReady]);

    const handleConsentApprove = useCallback(() => {
        if (consentRequest && bridgeRef.current) {
            // For now, approve with a placeholder — full tool execution
            // would require integration with the chat sendMessage flow
            bridgeRef.current.approveToolCall(consentRequest.requestId, {
                status: 'approved',
                note: 'Tool execution via MCP App bridge',
            });
            setConsentRequest(null);
        }
    }, [consentRequest]);

    const handleConsentDeny = useCallback(() => {
        if (consentRequest && bridgeRef.current) {
            bridgeRef.current.denyToolCall(consentRequest.requestId);
            setConsentRequest(null);
        }
    }, [consentRequest]);

    const height = uiMeta.dimensions?.height ?? 200;

    return (
        <>
            <div className="group relative my-3">
                <Collapsible open={isOpen} onOpenChange={setIsOpen}>
                    <div
                        className={cn(
                            'border rounded-lg bg-background-primary relative',
                            !isOpen && 'group-hover:bg-background-secondary',
                        )}
                    >
                        <div
                            className={cn(
                                'flex items-center justify-between text-foreground-secondary',
                                !isOpen && 'group-hover:text-foreground-primary',
                            )}
                        >
                            <CollapsibleTrigger asChild>
                                <div className="flex-1 flex items-center gap-2 cursor-pointer pl-3 py-2">
                                    {loadState === 'loading' ? (
                                        <Icons.LoadingSpinner className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <Icons.ChevronDown
                                            className={cn(
                                                'h-4 w-4 transition-transform duration-200',
                                                isOpen && 'rotate-180',
                                            )}
                                        />
                                    )}
                                    <div className={cn(
                                        'text-small pointer-events-none select-none flex items-center gap-1.5 min-w-0',
                                        loadState === 'loading' && 'text-shimmer',
                                    )}>
                                        <Icons.Globe className="h-3.5 w-3.5 flex-shrink-0" />
                                        <span className="truncate">{displayName}</span>
                                        <span className="text-mini text-foreground-tertiary flex-shrink-0">
                                            sandboxed
                                        </span>
                                    </div>
                                </div>
                            </CollapsibleTrigger>
                        </div>

                        <CollapsibleContent forceMount>
                            <AnimatePresence mode="wait">
                                <motion.div
                                    key="mcp-app-content"
                                    initial={isOpen ? { height: 'auto', opacity: 1 } : { height: 0, opacity: 0 }}
                                    animate={isOpen ? { height: 'auto', opacity: 1 } : { height: 0, opacity: 0 }}
                                    transition={{ duration: 0.2, ease: 'easeInOut' }}
                                    style={{ overflow: 'hidden' }}
                                >
                                    {isOpen && (
                                        <div className="border-t">
                                            {loadState === 'loading' && (
                                                <div className="flex items-center justify-center p-8 text-foreground-tertiary">
                                                    <Icons.LoadingSpinner className="h-5 w-5 animate-spin" />
                                                </div>
                                            )}
                                            {loadState === 'error' && (
                                                <div className="flex items-center justify-center p-8 text-foreground-tertiary text-small">
                                                    Failed to load MCP App resource
                                                </div>
                                            )}
                                            {loadState === 'loaded' && bridgeReady && (
                                                <McpAppSandbox
                                                    ref={iframeRef}
                                                    htmlContent={htmlContent}
                                                    height={height}
                                                    className="rounded-b-lg"
                                                />
                                            )}
                                        </div>
                                    )}
                                </motion.div>
                            </AnimatePresence>
                        </CollapsibleContent>
                    </div>
                </Collapsible>
            </div>

            {/* Consent dialog for UI-initiated tool calls */}
            <AlertDialog open={!!consentRequest} onOpenChange={(open) => {
                if (!open) handleConsentDeny();
            }}>
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>MCP App Tool Request</AlertDialogTitle>
                        <AlertDialogDescription asChild>
                            <div>
                                The MCP App wants to call tool{' '}
                                <code className="font-mono text-foreground bg-background-secondary px-1 py-0.5 rounded">
                                    {consentRequest?.toolName}
                                </code>
                                {consentRequest?.args != null && (
                                    <pre className="mt-2 text-xs bg-background-secondary p-2 rounded overflow-auto max-h-32">
                                        {JSON.stringify(consentRequest.args, null, 2)}
                                    </pre>
                                )}
                            </div>
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel onClick={handleConsentDeny}>Deny</AlertDialogCancel>
                        <AlertDialogAction onClick={handleConsentApprove}>Allow</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </>
    );
};

export const McpAppDisplay = memo(McpAppDisplayComponent);
