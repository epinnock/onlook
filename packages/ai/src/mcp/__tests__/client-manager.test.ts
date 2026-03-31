import { describe, expect, it } from 'vitest';

// Test the sanitizeServerName logic (extracted for testing)
function sanitizeServerName(name: string): string {
    return name
        .toLowerCase()
        .replace(/[^a-z0-9]/g, '_')
        .replace(/_+/g, '_')
        .replace(/^_|_$/g, '');
}

describe('MCP Client Manager', () => {
    describe('sanitizeServerName', () => {
        it('converts to lowercase and replaces special chars', () => {
            expect(sanitizeServerName('My Server')).toBe('my_server');
        });

        it('handles hyphens and dots', () => {
            expect(sanitizeServerName('my-server.com')).toBe('my_server_com');
        });

        it('collapses multiple underscores', () => {
            expect(sanitizeServerName('my--server')).toBe('my_server');
        });

        it('trims leading/trailing underscores', () => {
            expect(sanitizeServerName('_server_')).toBe('server');
        });

        it('handles simple names', () => {
            expect(sanitizeServerName('figma')).toBe('figma');
        });

        it('handles names with numbers', () => {
            expect(sanitizeServerName('server123')).toBe('server123');
        });
    });

    describe('tool name prefixing', () => {
        it('creates correct prefixed name', () => {
            const prefix = `mcp_${sanitizeServerName('My Figma')}`;
            const toolName = 'search_components';
            expect(`${prefix}_${toolName}`).toBe('mcp_my_figma_search_components');
        });
    });
});
