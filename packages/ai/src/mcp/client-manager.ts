import { experimental_createMCPClient as createMCPClient } from '@ai-sdk/mcp';
import type { MCPServerConfig } from '@onlook/models';
import type { ToolSet } from 'ai';

export interface MCPClientHandle {
    config: MCPServerConfig;
    client: Awaited<ReturnType<typeof createMCPClient>>;
}

/** Tool metadata from MCP tool definitions that @ai-sdk/mcp drops */
interface McpToolMeta {
    _meta?: Record<string, unknown>;
}

/** Per-tool metadata lookup, keyed by prefixed tool name */
export type McpToolMetaMap = Map<string, McpToolMeta>;

/**
 * Creates MCP clients for all enabled server configurations.
 * Each server connection is independent - one failure does not affect others.
 */
export async function createMCPClients(
    configs: MCPServerConfig[],
): Promise<MCPClientHandle[]> {
    const enabledConfigs = configs.filter((c) => c.enabled);
    if (enabledConfigs.length === 0) {
        return [];
    }

    const results = await Promise.allSettled(
        enabledConfigs.map(async (config) => {
            const headers: Record<string, string> = {};

            // Use OAuth token if available, otherwise fall back to API key
            if (config.oauth?.accessToken) {
                headers['Authorization'] = `Bearer ${config.oauth.accessToken}`;
            } else if (config.apiKey) {
                headers['Authorization'] = `Bearer ${config.apiKey}`;
            }

            const client = await createMCPClient({
                transport: {
                    type: config.transport,
                    url: config.url,
                    headers: Object.keys(headers).length > 0 ? headers : undefined,
                },
            });

            return { config, client } satisfies MCPClientHandle;
        }),
    );

    const handles: MCPClientHandle[] = [];
    for (const result of results) {
        if (result.status === 'fulfilled') {
            handles.push(result.value);
        } else {
            console.error(
                `Failed to connect to MCP server: ${result.reason}`,
            );
        }
    }

    return handles;
}

/**
 * Sanitizes a server name for use as a tool name prefix.
 * Converts to lowercase, replaces non-alphanumeric chars with underscores.
 */
function sanitizeServerName(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
}

/**
 * Gets tools from all connected MCP clients, prefixed with server names
 * to avoid collisions with native tools or other MCP servers.
 *
 * Also returns a metadata map with _meta from tool definitions that
 * @ai-sdk/mcp drops (needed for MCP Apps UI resourceUri).
 */
export async function getMCPToolSet(
    clients: MCPClientHandle[],
): Promise<{ tools: ToolSet; metaMap: McpToolMetaMap }> {
    const metaMap: McpToolMetaMap = new Map();

    if (clients.length === 0) {
        return { tools: {}, metaMap };
    }

    const toolSets = await Promise.allSettled(
        clients.map(async ({ client, config }) => {
            const tools = await client.tools();
            const prefix = `mcp_${sanitizeServerName(config.name)}`;

            // Fetch raw tool definitions to capture _meta that @ai-sdk/mcp drops.
            // listTools() is on the underlying client but not in the MCPClient type.
            let rawToolDefs: Array<{ name: string; _meta?: Record<string, unknown> }> = [];
            try {
                const rawClient = client as unknown as { listTools: () => Promise<{ tools: Array<{ name: string; _meta?: Record<string, unknown> }> }> };
                if (typeof rawClient.listTools === 'function') {
                    const listResult = await rawClient.listTools();
                    rawToolDefs = listResult.tools;
                    console.log(`[MCP discovery/server] listTools returned ${rawToolDefs.length} tools from ${config.name}`);
                    for (const def of rawToolDefs) {
                        console.log(`[MCP discovery/server] Tool "${def.name}" _meta:`, JSON.stringify(def._meta)?.substring(0, 200));
                    }
                }
            } catch (err) {
                console.log(`[MCP discovery/server] listTools failed for ${config.name}:`, err);
            }

            // Build a lookup from raw tool name → _meta
            const rawMetaByName = new Map<string, Record<string, unknown>>();
            for (const def of rawToolDefs) {
                if (def._meta) {
                    rawMetaByName.set(def.name, def._meta);
                }
            }
            console.log(`[MCP discovery/server] ${rawMetaByName.size} tools have _meta`);

            // Prefix each tool name and wrap execute to transform MCP results
            const prefixed: ToolSet = {};
            for (const [name, tool] of Object.entries(tools)) {
                const prefixedName = `${prefix}_${name}`;
                const originalTool = tool as ToolSet[string];

                // Store _meta in the metadata map for UI rendering
                const toolMeta = rawMetaByName.get(name);
                if (toolMeta) {
                    metaMap.set(prefixedName, { _meta: toolMeta });
                }

                // Wrap execute to transform MCP CallToolResult into AI SDK format.
                // The MCP SDK returns { content: [...], isError, structuredContent }
                // but the AI SDK expects a plain JSON value for tool output serialization.
                if (originalTool.execute) {
                    const originalExecute = originalTool.execute;
                    // Capture _meta for this tool to inject into results
                    const capturedMeta = toolMeta;
                    const wrappedExecute = async (...args: Parameters<typeof originalExecute>) => {
                        const result = await originalExecute(...args);
                        const mcpResult = result as Record<string, unknown> | undefined;

                        // Transform MCP CallToolResult → plain object the AI SDK can serialize
                        if (mcpResult && Array.isArray(mcpResult.content)) {
                            const contentArray = mcpResult.content as Array<{ type: string; text?: string; data?: string; mimeType?: string }>;

                            // Extract text from content array for the LLM
                            const textParts = contentArray
                                .filter(c => c.type === 'text' && c.text)
                                .map(c => c.text)
                                .join('\n');

                            // Extract image content blocks (base64 data from MCP image responses)
                            const images = contentArray
                                .filter(c => c.type === 'image' && c.data)
                                .map(c => ({
                                    data: c.data!,
                                    mimeType: c.mimeType || 'image/png',
                                }));

                            // Return a plain object that includes text (for LLM), images,
                            // structuredContent (for UI), _meta (for MCP Apps widget rendering),
                            // and mcpServerUrl (for resolving ui:// resource URIs)
                            return {
                                text: textParts,
                                images: images.length > 0 ? images : undefined,
                                structuredContent: mcpResult.structuredContent,
                                _meta: capturedMeta,
                                mcpServerUrl: config.url,
                                isError: mcpResult.isError ?? false,
                            };
                        }

                        return result;
                    };
                    prefixed[prefixedName] = { ...originalTool, execute: wrappedExecute } as ToolSet[string];
                } else {
                    prefixed[prefixedName] = originalTool;
                }
            }
            return prefixed;
        }),
    );

    const merged: ToolSet = {};
    for (const result of toolSets) {
        if (result.status === 'fulfilled') {
            Object.assign(merged, result.value);
        } else {
            console.error(
                `Failed to get tools from MCP server: ${result.reason}`,
            );
        }
    }

    return { tools: merged, metaMap };
}

/**
 * Closes all MCP client connections gracefully.
 */
export async function closeMCPClients(
    clients: MCPClientHandle[],
): Promise<void> {
    await Promise.allSettled(clients.map(({ client }) => client.close()));
}
