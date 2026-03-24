import type { ToolUIPart } from 'ai';

export interface McpAppUiMeta {
    resourceUri: string;
    title?: string;
    dimensions?: { width?: number; height?: number };
}

/**
 * Checks if a tool result includes MCP App UI metadata.
 * Returns the UI metadata if present, null otherwise.
 */
export function getMcpAppUiResource(toolPart: ToolUIPart): McpAppUiMeta | null {
    if (toolPart.state !== 'output-available') {
        return null;
    }

    const output = toolPart.output as Record<string, unknown> | null;
    if (!output) {
        return null;
    }

    // The AI SDK wraps tool output as { type: "json", value: { ... } } — unwrap if needed
    const raw = (output.type === 'json' && output.value && typeof output.value === 'object')
        ? output.value as Record<string, unknown>
        : output;

    // Check for _meta.ui.resourceUri in tool output
    const meta = raw._meta as Record<string, unknown> | undefined;
    const ui = meta?.ui as Record<string, unknown> | undefined;
    const resourceUri = ui?.resourceUri;

    if (typeof resourceUri === 'string' && resourceUri.startsWith('ui://')) {
        return {
            resourceUri,
            title: typeof ui?.title === 'string' ? ui.title : undefined,
            dimensions: ui?.dimensions as McpAppUiMeta['dimensions'],
        };
    }

    return null;
}

/**
 * Resolves a ui:// resource URI to a fetchable HTTP URL.
 * ui://server-name/widget-name → {mcpServerBaseUrl}/_mcp/ui/server-name/widget-name
 *
 * If no MCP server URL is available, returns the raw URI for fallback handling.
 */
export function resolveUiResourceUri(
    resourceUri: string,
    mcpServerUrl?: string,
): string {
    if (!mcpServerUrl) {
        return resourceUri;
    }

    // Strip ui:// prefix and resolve against the MCP server
    const path = resourceUri.replace(/^ui:\/\//, '');
    const base = mcpServerUrl.replace(/\/$/, '');
    return `${base}/_mcp/ui/${path}`;
}

/**
 * Extract the MCP server name from a prefixed tool name.
 * e.g., "mcp_myserver_search" → "myserver"
 */
export function parseMcpToolName(toolName: string): {
    serverName: string;
    originalToolName: string;
} | null {
    if (!toolName.startsWith('mcp_')) {
        return null;
    }

    const withoutPrefix = toolName.slice(4); // remove "mcp_"
    const underscoreIndex = withoutPrefix.indexOf('_');
    if (underscoreIndex === -1) {
        return { serverName: withoutPrefix, originalToolName: withoutPrefix };
    }

    return {
        serverName: withoutPrefix.slice(0, underscoreIndex),
        originalToolName: withoutPrefix.slice(underscoreIndex + 1),
    };
}
