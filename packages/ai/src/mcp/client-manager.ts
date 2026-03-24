import { experimental_createMCPClient as createMCPClient } from '@ai-sdk/mcp';
import type { MCPServerConfig } from '@onlook/models';
import type { ToolSet } from 'ai';

export interface MCPClientHandle {
    config: MCPServerConfig;
    client: Awaited<ReturnType<typeof createMCPClient>>;
}

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
 */
export async function getMCPToolSet(
    clients: MCPClientHandle[],
): Promise<ToolSet> {
    if (clients.length === 0) {
        return {};
    }

    const toolSets = await Promise.allSettled(
        clients.map(async ({ client, config }) => {
            const tools = await client.tools();
            const prefix = `mcp_${sanitizeServerName(config.name)}`;

            // Prefix each tool name and wrap execute to transform MCP results
            const prefixed: ToolSet = {};
            for (const [name, tool] of Object.entries(tools)) {
                const prefixedName = `${prefix}_${name}`;
                const originalTool = tool as ToolSet[string];

                // Wrap execute to transform MCP CallToolResult into AI SDK format.
                // The MCP SDK returns { content: [...], isError, structuredContent }
                // but the AI SDK expects a plain JSON value for tool output serialization.
                if (originalTool.execute) {
                    const originalExecute = originalTool.execute;
                    const wrappedExecute = async (...args: Parameters<typeof originalExecute>) => {
                        const result = await originalExecute(...args);
                        const mcpResult = result as Record<string, unknown> | undefined;

                        // Transform MCP CallToolResult → plain object the AI SDK can serialize
                        if (mcpResult && Array.isArray(mcpResult.content)) {
                            // Extract text from content array for the LLM
                            const textParts = (mcpResult.content as Array<{ type: string; text?: string }>)
                                .filter(c => c.type === 'text' && c.text)
                                .map(c => c.text)
                                .join('\n');

                            // Return a plain object that includes both text (for LLM) and structuredContent (for UI)
                            return {
                                text: textParts,
                                structuredContent: mcpResult.structuredContent,
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

    return merged;
}

/**
 * Closes all MCP client connections gracefully.
 */
export async function closeMCPClients(
    clients: MCPClientHandle[],
): Promise<void> {
    await Promise.allSettled(clients.map(({ client }) => client.close()));
}
