import { describe, expect, it } from 'vitest';
import { getMcpAppUiResource, parseMcpToolName, resolveUiResourceUri } from '../mcp-app-utils';
import type { ToolUIPart } from 'ai';

describe('MCP App Utils', () => {
    describe('getMcpAppUiResource', () => {
        it('returns null for non-output-available state', () => {
            const toolPart = {
                type: 'tool-mcp_server_tool',
                toolCallId: 'test-id',
                state: 'input-available',
                input: {},
                output: null,
            } as unknown as ToolUIPart;

            expect(getMcpAppUiResource(toolPart)).toBeNull();
        });

        it('returns null when output has no _meta', () => {
            const toolPart = {
                type: 'tool-mcp_server_tool',
                toolCallId: 'test-id',
                state: 'output-available',
                input: {},
                output: { result: 'data' },
            } as unknown as ToolUIPart;

            expect(getMcpAppUiResource(toolPart)).toBeNull();
        });

        it('returns null when output is null', () => {
            const toolPart = {
                type: 'tool-mcp_server_tool',
                toolCallId: 'test-id',
                state: 'output-available',
                input: {},
                output: null,
            } as unknown as ToolUIPart;

            expect(getMcpAppUiResource(toolPart)).toBeNull();
        });

        it('returns meta when _meta.ui.resourceUri exists with ui:// scheme', () => {
            const toolPart = {
                type: 'tool-mcp_server_visualize',
                toolCallId: 'test-id',
                state: 'output-available',
                input: {},
                output: {
                    data: [1, 2, 3],
                    _meta: {
                        ui: {
                            resourceUri: 'ui://charts/bar-chart',
                            title: 'Bar Chart',
                        },
                    },
                },
            } as unknown as ToolUIPart;

            const result = getMcpAppUiResource(toolPart);
            expect(result).not.toBeNull();
            expect(result!.resourceUri).toBe('ui://charts/bar-chart');
            expect(result!.title).toBe('Bar Chart');
        });

        it('returns null when resourceUri does not start with ui://', () => {
            const toolPart = {
                type: 'tool-mcp_server_tool',
                toolCallId: 'test-id',
                state: 'output-available',
                input: {},
                output: {
                    _meta: {
                        ui: {
                            resourceUri: 'https://example.com/chart',
                        },
                    },
                },
            } as unknown as ToolUIPart;

            expect(getMcpAppUiResource(toolPart)).toBeNull();
        });
    });

    describe('resolveUiResourceUri', () => {
        it('resolves ui:// URI against MCP server URL', () => {
            const result = resolveUiResourceUri(
                'ui://charts/interactive',
                'https://mcp.example.com',
            );
            expect(result).toBe('https://mcp.example.com/_mcp/ui/charts/interactive');
        });

        it('strips trailing slash from server URL', () => {
            const result = resolveUiResourceUri(
                'ui://widget/form',
                'https://mcp.example.com/',
            );
            expect(result).toBe('https://mcp.example.com/_mcp/ui/widget/form');
        });

        it('returns raw URI when no server URL provided', () => {
            const result = resolveUiResourceUri('ui://charts/bar');
            expect(result).toBe('ui://charts/bar');
        });
    });

    describe('parseMcpToolName', () => {
        it('parses prefixed MCP tool name correctly', () => {
            const result = parseMcpToolName('mcp_figma_search_components');
            expect(result).toEqual({
                serverName: 'figma',
                originalToolName: 'search_components',
            });
        });

        it('returns null for non-MCP tool names', () => {
            expect(parseMcpToolName('read_file')).toBeNull();
            expect(parseMcpToolName('write_file')).toBeNull();
        });

        it('handles server names without underscores in tool name', () => {
            const result = parseMcpToolName('mcp_myserver');
            expect(result).toEqual({
                serverName: 'myserver',
                originalToolName: 'myserver',
            });
        });

        it('handles multi-word server names', () => {
            const result = parseMcpToolName('mcp_my_server_get_data');
            expect(result).toEqual({
                serverName: 'my',
                originalToolName: 'server_get_data',
            });
        });
    });
});
