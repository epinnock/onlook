'use client';

import { useEditorEngine } from '@/components/store/editor';
import { api } from '@/trpc/react';
import { toDbProjectSettings } from '@onlook/db';
import type { MCPServerConfig } from '@onlook/models';
import { Button } from '@onlook/ui/button';
import { Icons } from '@onlook/ui/icons';
import { Input } from '@onlook/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@onlook/ui/select';
import { Separator } from '@onlook/ui/separator';
import { toast } from '@onlook/ui/sonner';
import { Switch } from '@onlook/ui/switch';
import { observer } from 'mobx-react-lite';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { v4 as uuidv4 } from 'uuid';

const EMPTY_SERVER: Omit<MCPServerConfig, 'id'> = {
    name: '',
    transport: 'http',
    url: '',
    authType: 'none',
    apiKey: '',
    enabled: true,
};

export const McpServersTab = observer(() => {
    const editorEngine = useEditorEngine();
    const { data: projectSettings } = api.settings.get.useQuery({ projectId: editorEngine.projectId });
    const { mutateAsync: updateProjectSettings } = api.settings.upsert.useMutation();

    const savedServers = projectSettings?.mcpServers ?? [];

    const [servers, setServers] = useState<MCPServerConfig[]>([]);
    const [isAdding, setIsAdding] = useState(false);
    const [newServer, setNewServer] = useState<Omit<MCPServerConfig, 'id'>>(EMPTY_SERVER);
    const [isSaving, setIsSaving] = useState(false);
    const [connectingServerId, setConnectingServerId] = useState<string | null>(null);

    useEffect(() => {
        setServers(savedServers);
    }, [JSON.stringify(savedServers)]);

    const isDirty = useMemo(() => {
        return JSON.stringify(servers) !== JSON.stringify(savedServers);
    }, [servers, savedServers]);

    // Persist servers to DB
    const saveServers = useCallback(
        async (serversToSave: MCPServerConfig[]) => {
            try {
                await updateProjectSettings({
                    projectId: editorEngine.projectId,
                    settings: toDbProjectSettings(editorEngine.projectId, {
                        commands: projectSettings?.commands ?? { build: '', run: '', install: '' },
                        mcpServers: serversToSave,
                    }),
                });
            } catch (error) {
                console.error('Failed to save MCP settings:', error);
                toast.error('Failed to save MCP settings.');
            }
        },
        [editorEngine.projectId, projectSettings?.commands, updateProjectSettings],
    );

    // Listen for OAuth callback messages from popup window
    useEffect(() => {
        const handler = (event: MessageEvent) => {
            if (event.origin !== window.location.origin) return;
            if (event.data?.type !== 'mcp-oauth-result') return;

            const { success, data, error } = event.data;
            if (success && data) {
                // Update the server with OAuth tokens and auto-save
                setServers((prev) => {
                    const updated = prev.map((s) =>
                        s.id === data.serverId
                            ? {
                                  ...s,
                                  authType: 'oauth' as const,
                                  oauth: {
                                      accessToken: data.accessToken,
                                      refreshToken: data.refreshToken,
                                      expiresAt: data.expiresIn
                                          ? Date.now() + data.expiresIn * 1000
                                          : undefined,
                                  },
                              }
                            : s,
                    );
                    // Auto-save tokens to DB so they persist across sessions
                    void saveServers(updated);
                    return updated;
                });
                toast.success('Connected to MCP server');
            } else {
                toast.error(`OAuth failed: ${error || 'Unknown error'}`);
            }
            setConnectingServerId(null);
        };

        window.addEventListener('message', handler);
        return () => window.removeEventListener('message', handler);
    }, [saveServers]);

    const handleAddServer = () => {
        if (!newServer.name || !newServer.url) {
            toast.error('Name and URL are required');
            return;
        }

        const server: MCPServerConfig = {
            ...newServer,
            id: uuidv4(),
        };
        setServers((prev) => [...prev, server]);
        setNewServer(EMPTY_SERVER);
        setIsAdding(false);
    };

    const handleRemoveServer = (id: string) => {
        setServers((prev) => prev.filter((s) => s.id !== id));
    };

    const handleToggleServer = (id: string) => {
        setServers((prev) =>
            prev.map((s) => (s.id === id ? { ...s, enabled: !s.enabled } : s)),
        );
    };

    const handleOAuthConnect = useCallback(
        (server: MCPServerConfig) => {
            setConnectingServerId(server.id);
            const params = new URLSearchParams({
                action: 'start',
                serverUrl: server.url,
                serverId: server.id,
                projectId: editorEngine.projectId,
            });
            const oauthUrl = `/api/mcp/oauth?${params.toString()}`;
            window.open(oauthUrl, 'mcp-oauth', 'width=600,height=700,popup=true');
        },
        [editorEngine.projectId],
    );

    const handleSave = async () => {
        setIsSaving(true);
        await saveServers(servers);
        toast.success('MCP server settings saved.');
        setIsSaving(false);
    };

    const handleDiscard = () => {
        setServers(savedServers);
        setIsAdding(false);
        setNewServer(EMPTY_SERVER);
    };

    const getAuthStatus = (server: MCPServerConfig) => {
        if (server.oauth?.accessToken) return 'connected';
        if (server.apiKey) return 'api-key';
        return 'none';
    };

    return (
        <div className="text-sm flex flex-col h-full">
            <div className="flex flex-col gap-4 p-6 pb-24 overflow-y-auto flex-1">
                <div className="flex flex-col gap-2">
                    <h2 className="text-lg">MCP Servers</h2>
                    <p className="text-small text-foreground-secondary">
                        Connect external MCP servers to extend AI capabilities with custom tools. MCP
                        tools run server-side alongside the AI agent.
                    </p>
                </div>

                {/* Server list */}
                {servers.length > 0 && (
                    <div className="flex flex-col gap-3">
                        {servers.map((server) => {
                            const authStatus = getAuthStatus(server);
                            return (
                                <div
                                    key={server.id}
                                    className="flex items-center justify-between p-3 border rounded-lg"
                                >
                                    <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                                        <div className="flex items-center gap-2">
                                            <Icons.Globe className="h-4 w-4 flex-shrink-0 text-foreground-secondary" />
                                            <span className="font-medium truncate">{server.name}</span>
                                            <span className="text-mini text-foreground-tertiary px-1.5 py-0.5 bg-background-secondary rounded">
                                                {server.transport.toUpperCase()}
                                            </span>
                                            {authStatus === 'connected' && (
                                                <span className="text-mini text-green-500 px-1.5 py-0.5 bg-green-500/10 rounded">
                                                    Connected
                                                </span>
                                            )}
                                        </div>
                                        <span className="text-small text-foreground-tertiary truncate ml-6">
                                            {server.url}
                                        </span>
                                    </div>
                                    <div className="flex items-center gap-2 flex-shrink-0 ml-3">
                                        {authStatus === 'none' && (
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                className="h-7 text-xs"
                                                onClick={() => handleOAuthConnect(server)}
                                                disabled={connectingServerId === server.id}
                                            >
                                                {connectingServerId === server.id ? (
                                                    <Icons.LoadingSpinner className="h-3 w-3 animate-spin mr-1" />
                                                ) : null}
                                                Connect
                                            </Button>
                                        )}
                                        <Switch
                                            checked={server.enabled}
                                            onCheckedChange={() => handleToggleServer(server.id)}
                                        />
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            className="h-8 w-8 text-foreground-tertiary hover:text-destructive"
                                            onClick={() => handleRemoveServer(server.id)}
                                        >
                                            <Icons.Trash className="h-4 w-4" />
                                        </Button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {servers.length === 0 && !isAdding && (
                    <div className="flex flex-col items-center justify-center py-8 text-foreground-tertiary">
                        <Icons.Globe className="h-8 w-8 mb-2 opacity-50" />
                        <p className="text-small">No MCP servers configured</p>
                    </div>
                )}

                <Separator />

                {/* Add server form */}
                {isAdding ? (
                    <div className="flex flex-col gap-4 p-4 border rounded-lg">
                        <h3 className="text-regular font-medium">Add MCP Server</h3>
                        <div className="space-y-3">
                            <div className="flex justify-between items-center">
                                <p className="text-muted-foreground">Name</p>
                                <Input
                                    value={newServer.name}
                                    onChange={(e) =>
                                        setNewServer((prev) => ({ ...prev, name: e.target.value }))
                                    }
                                    placeholder="My MCP Server"
                                    className="w-2/3"
                                />
                            </div>
                            <div className="flex justify-between items-center">
                                <p className="text-muted-foreground">Transport</p>
                                <Select
                                    value={newServer.transport}
                                    onValueChange={(v) =>
                                        setNewServer((prev) => ({
                                            ...prev,
                                            transport: v as 'sse' | 'http',
                                        }))
                                    }
                                >
                                    <SelectTrigger className="w-2/3">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="http">HTTP</SelectItem>
                                        <SelectItem value="sse">SSE</SelectItem>
                                    </SelectContent>
                                </Select>
                            </div>
                            <div className="flex justify-between items-center">
                                <p className="text-muted-foreground">URL</p>
                                <Input
                                    value={newServer.url}
                                    onChange={(e) =>
                                        setNewServer((prev) => ({ ...prev, url: e.target.value }))
                                    }
                                    placeholder="https://mcp.example.com/mcp"
                                    className="w-2/3"
                                />
                            </div>
                        </div>
                        <p className="text-mini text-foreground-tertiary">
                            After adding, click &quot;Connect&quot; to authenticate with servers that require login.
                        </p>
                        <div className="flex justify-end gap-2">
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => {
                                    setIsAdding(false);
                                    setNewServer(EMPTY_SERVER);
                                }}
                            >
                                Cancel
                            </Button>
                            <Button
                                variant="secondary"
                                size="sm"
                                onClick={handleAddServer}
                                disabled={!newServer.name || !newServer.url}
                            >
                                Add Server
                            </Button>
                        </div>
                    </div>
                ) : (
                    <Button
                        variant="outline"
                        className="w-full"
                        onClick={() => setIsAdding(true)}
                    >
                        <Icons.Plus className="h-4 w-4 mr-2" />
                        Add MCP Server
                    </Button>
                )}
            </div>

            {/* Save/Discard buttons */}
            <div
                className="sticky bottom-0 bg-background border-t border-border/50 p-6"
                style={{ borderTopWidth: '0.5px' }}
            >
                <div className="flex justify-end gap-4">
                    <Button
                        variant="outline"
                        className="flex items-center gap-2 px-4 py-2 bg-background border border-border/50"
                        type="button"
                        onClick={handleDiscard}
                        disabled={!isDirty || isSaving}
                    >
                        <span>Discard changes</span>
                    </Button>
                    <Button
                        variant="secondary"
                        className="flex items-center gap-2 px-4 py-2"
                        type="button"
                        onClick={handleSave}
                        disabled={!isDirty || isSaving}
                    >
                        {isSaving && <Icons.LoadingSpinner className="h-4 w-4 animate-spin" />}
                        <span>{isSaving ? 'Saving...' : 'Save changes'}</span>
                    </Button>
                </div>
            </div>
        </div>
    );
});
