/**
 * MCP Apps Debug Logger
 *
 * Instruments the entire MCP Apps lifecycle:
 * 1. Discovery: _meta extraction from tool definitions
 * 2. Resource loading: widget HTML fetch via proxy
 * 3. Bridge setup: addEventListener timing
 * 4. Initialization: ui/initialize handshake
 * 5. Data delivery: ui/notifications/tool-result push
 * 6. Widget rendering: iframe content state
 *
 * Server-side logs write to /tmp/mcp-apps-debug/server.log
 * Client-side logs post to /api/mcp/debug-log endpoint
 */

const LOG_ENDPOINT = '/api/mcp/debug-log';

interface LogEntry {
    timestamp: string;
    phase: 'discovery' | 'resource-load' | 'bridge-setup' | 'initialize' | 'data-delivery' | 'widget-render' | 'postmessage' | 'error';
    source: 'server' | 'client' | 'bridge' | 'iframe';
    message: string;
    data?: unknown;
}

function makeEntry(phase: LogEntry['phase'], source: LogEntry['source'], message: string, data?: unknown): LogEntry {
    return {
        timestamp: new Date().toISOString(),
        phase,
        source,
        message,
        data: data !== undefined ? (typeof data === 'object' ? JSON.stringify(data)?.substring(0, 500) : data) : undefined,
    };
}

/**
 * Client-side logger — sends logs to the debug endpoint AND console.
 */
export const mcpDebug = {
    log(phase: LogEntry['phase'], source: LogEntry['source'], message: string, data?: unknown) {
        const entry = makeEntry(phase, source, message, data);
        const prefix = `[MCP ${phase}/${source}]`;
        console.log(prefix, message, data !== undefined ? data : '');

        // Fire-and-forget POST to server for persistent logging
        try {
            fetch(LOG_ENDPOINT, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(entry),
            }).catch(() => {}); // Swallow fetch errors
        } catch {
            // Ignore
        }
    },

    discovery(message: string, data?: unknown) {
        this.log('discovery', 'client', message, data);
    },

    resourceLoad(message: string, data?: unknown) {
        this.log('resource-load', 'client', message, data);
    },

    bridgeSetup(message: string, data?: unknown) {
        this.log('bridge-setup', 'bridge', message, data);
    },

    initialize(message: string, data?: unknown) {
        this.log('initialize', 'bridge', message, data);
    },

    dataDelivery(message: string, data?: unknown) {
        this.log('data-delivery', 'bridge', message, data);
    },

    postMessage(direction: 'sent' | 'received', method: string, data?: unknown) {
        this.log('postmessage', 'bridge', `${direction}: ${method}`, data);
    },

    widgetRender(message: string, data?: unknown) {
        this.log('widget-render', 'client', message, data);
    },

    error(message: string, data?: unknown) {
        this.log('error', 'client', message, data);
        console.error(`[MCP ERROR]`, message, data);
    },
};

/**
 * Server-side logger — writes directly to file.
 * Import this only in server-side code (API routes).
 */
export async function serverLog(phase: LogEntry['phase'], message: string, data?: unknown) {
    const entry = makeEntry(phase, 'server', message, data);
    const line = JSON.stringify(entry) + '\n';

    try {
        const fs = await import('fs/promises');
        await fs.appendFile('/tmp/mcp-apps-debug/server.log', line);
    } catch {
        console.log(`[MCP ${phase}/server]`, message, data);
    }
}
