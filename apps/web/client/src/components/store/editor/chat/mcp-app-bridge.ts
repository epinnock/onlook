/**
 * McpAppBridge handles JSON-RPC communication between MCP App iframes
 * and the Onlook host application via postMessage.
 *
 * Supported methods:
 * - getToolResult: Returns the cached tool output to the iframe
 * - callServerTool: Requests server tool execution (requires user consent)
 * - updateModelContext: Adds context for the AI to consider in future messages
 */

interface JsonRpcRequest {
    jsonrpc: '2.0';
    id: string | number;
    method: string;
    params?: Record<string, unknown>;
}

interface JsonRpcResponse {
    jsonrpc: '2.0';
    id: string | number;
    result?: unknown;
    error?: { code: number; message: string; data?: unknown };
}

interface JsonRpcNotification {
    jsonrpc: '2.0';
    method: string;
    params: Record<string, unknown>;
}

export interface McpToolCallRequest {
    requestId: string | number;
    toolName: string;
    args: unknown;
}

const ALLOWED_METHODS = ['getToolResult', 'callServerTool', 'updateModelContext'] as const;

type AllowedMethod = (typeof ALLOWED_METHODS)[number];

/** MCP Apps protocol version */
const MCP_APPS_PROTOCOL_VERSION = '2026-01-26';

export class McpAppBridge {
    private iframe: HTMLIFrameElement | null = null;
    private toolResult: unknown;
    private messageHandler: ((event: MessageEvent) => void) | null = null;
    private contextUpdates: Array<{ type: 'text'; text: string }> = [];
    private initialized = false;

    /**
     * Pending tool call request awaiting user consent.
     * UI components should observe this to show a consent dialog.
     */
    pendingConsent: McpToolCallRequest | null = null;

    constructor(toolResult: unknown) {
        this.toolResult = toolResult;
    }

    /**
     * Connect the bridge to an iframe element and start listening for messages.
     */
    connect(iframe: HTMLIFrameElement): void {
        this.iframe = iframe;
        this.startListening();
    }

    /**
     * Start listening globally before the iframe exists.
     * Messages from any source are accepted until bindIframe() narrows it.
     */
    connectGlobal(): void {
        this.startListening();
    }

    /**
     * Bind the bridge to a specific iframe after it's rendered.
     */
    bindIframe(iframe: HTMLIFrameElement): void {
        this.iframe = iframe;
    }

    private startListening(): void {
        if (this.messageHandler) return;
        console.log(`[MCP bridge-setup/bridge] addEventListener called, iframe bound: ${!!this.iframe}`);
        this.messageHandler = (event: MessageEvent) => {
            // Log ALL jsonrpc messages for debugging
            if (event.data?.jsonrpc === '2.0') {
                const matchesIframe = this.iframe ? event.source === this.iframe.contentWindow : 'no-iframe';
                console.log(`[MCP postmessage/bridge] received: method=${event.data.method || 'response'} id=${event.data.id} sourceMatchesIframe=${matchesIframe}`);
            }
            this.handleMessage(event);
        };
        window.addEventListener('message', this.messageHandler);
    }

    /**
     * Disconnect and stop listening for messages.
     */
    disconnect(): void {
        if (this.messageHandler) {
            window.removeEventListener('message', this.messageHandler);
            this.messageHandler = null;
        }
        this.iframe = null;
        this.pendingConsent = null;
    }

    /**
     * Get any accumulated context updates from the MCP App.
     */
    getContextUpdates(): Array<{ type: 'text'; text: string }> {
        return this.contextUpdates;
    }

    /**
     * Approve a pending tool call request.
     * The caller is responsible for executing the tool and passing the result.
     */
    approveToolCall(requestId: string | number, result: unknown): void {
        this.sendResponse(requestId, result);
        this.pendingConsent = null;
    }

    /**
     * Deny a pending tool call request.
     */
    denyToolCall(requestId: string | number): void {
        this.sendError(requestId, -32000, 'User denied tool execution');
        this.pendingConsent = null;
    }

    private handleMessage(event: MessageEvent): void {
        // If iframe is bound, validate the source. Otherwise accept from any iframe.
        if (this.iframe && event.source !== this.iframe.contentWindow) {
            return;
        }

        const data = event.data;
        if (!data || data.jsonrpc !== '2.0') {
            return;
        }

        if (process.env.NODE_ENV === 'development') {
            console.log('[MCP App Bridge] Received:', data.method, data);
        }

        // Handle notifications (no id) — e.g., ui/notifications/initialized
        // Note: id can be 0 which is falsy, so check for undefined/null explicitly
        if (data.id === undefined && data.method) {
            this.handleNotification(data as JsonRpcNotification);
            return;
        }

        if (!data.method || data.id === undefined) {
            return;
        }

        const request = data as JsonRpcRequest;

        // Handle MCP Apps protocol methods
        switch (request.method) {
            // MCP Apps initialization handshake
            case 'ui/initialize':
                this.handleInitialize(request);
                return;
            // Standard ping
            case 'ping':
                this.sendResponse(request.id, {});
                return;
            // MCP Apps resource/tool methods
            case 'tools/call':
                this.handleCallServerTool(request);
                return;
            case 'resources/read':
                this.sendError(request.id, -32601, 'resources/read not supported');
                return;
            case 'ui/open-link':
                this.handleOpenLink(request);
                return;
        }

        // Legacy custom methods
        if (ALLOWED_METHODS.includes(request.method as AllowedMethod)) {
            switch (request.method as AllowedMethod) {
                case 'getToolResult':
                    this.handleGetToolResult(request);
                    break;
                case 'callServerTool':
                    this.handleCallServerTool(request);
                    break;
                case 'updateModelContext':
                    this.handleUpdateModelContext(request);
                    break;
            }
            return;
        }

        this.sendError(request.id, -32601, `Method not found: ${request.method}`);
    }

    private handleNotification(notification: JsonRpcNotification): void {
        if (notification.method === 'ui/notifications/initialized') {
            // Widget confirmed initialization — now push the tool result
            if (!this.initialized) {
                this.initialized = true;
                this.pushToolResult();
            }
        } else if (notification.method === 'ui/notifications/size-changed') {
            // Widget reported size change — could be used for dynamic iframe sizing
        }
    }

    private handleInitialize(request: JsonRpcRequest): void {
        console.log(`[MCP initialize/bridge] Responding to ui/initialize (id=${request.id}), iframe bound: ${!!this.iframe}`);
        // Respond with host capabilities for the MCP Apps protocol
        this.sendResponse(request.id, {
            protocolVersion: MCP_APPS_PROTOCOL_VERSION,
            hostInfo: { name: 'onlook', version: '1.0.0' },
            hostCapabilities: {
                openLinks: {},
                serverTools: {},
            },
            hostContext: {
                theme: 'dark',
            },
        });
    }

    /**
     * Push the tool result to the widget as an MCP Apps notification.
     * Called after the widget sends ui/notifications/initialized.
     *
     * The MCP Apps protocol expects params to be a standard MCP CallToolResult:
     *   { content: [{ type: "text", text: "..." }], structuredContent: {...}, isError: false }
     */
    private pushToolResult(): void {
        console.log(`[MCP data-delivery/bridge] Pushing tool result, iframe bound: ${!!this.iframe}, has contentWindow: ${!!this.iframe?.contentWindow}`);
        // Unwrap AI SDK output wrapper if present
        const output = this.toolResult as Record<string, unknown> | undefined;
        const raw = (output?.type === 'json' && output?.value && typeof output.value === 'object')
            ? output.value as Record<string, unknown>
            : output;

        if (!raw) return;

        // Build a standard MCP CallToolResult for the widget
        // The widget's ontoolresult handler receives params directly
        const textContent = typeof raw.text === 'string' ? raw.text : '';
        const content: Array<Record<string, unknown>> = [];

        if (textContent) {
            content.push({ type: 'text', text: textContent });
        }

        // Include image content blocks if present
        const images = raw.images as Array<{ data: string; mimeType: string }> | undefined;
        if (images) {
            for (const img of images) {
                content.push({ type: 'image', data: img.data, mimeType: img.mimeType });
            }
        }

        // If no content was built, add a fallback
        if (content.length === 0) {
            content.push({ type: 'text', text: JSON.stringify(raw) });
        }

        this.sendNotification('ui/notifications/tool-result', {
            content,
            structuredContent: raw.structuredContent ?? undefined,
            isError: raw.isError ?? false,
        });
    }

    private handleOpenLink(request: JsonRpcRequest): void {
        const url = (request.params as Record<string, unknown>)?.url;
        if (typeof url === 'string') {
            window.open(url, '_blank', 'noopener,noreferrer');
            this.sendResponse(request.id, {});
        } else {
            this.sendError(request.id, -32602, 'Missing url parameter');
        }
    }

    private handleGetToolResult(request: JsonRpcRequest): void {
        this.sendResponse(request.id, this.toolResult);
    }

    private handleCallServerTool(request: JsonRpcRequest): void {
        const params = request.params;
        if (!params?.name || typeof params.name !== 'string') {
            this.sendError(request.id, -32602, 'Missing required parameter: name');
            return;
        }

        // Store as pending — UI must show consent dialog
        this.pendingConsent = {
            requestId: request.id,
            toolName: params.name,
            args: params.arguments ?? {},
        };
    }

    private handleUpdateModelContext(request: JsonRpcRequest): void {
        const params = request.params;
        const content = params?.content as Array<{ type: string; text: string }> | undefined;

        if (!Array.isArray(content)) {
            this.sendError(request.id, -32602, 'Missing required parameter: content');
            return;
        }

        for (const item of content) {
            if (item.type === 'text' && typeof item.text === 'string') {
                this.contextUpdates.push({ type: 'text', text: item.text });
            }
        }

        this.sendResponse(request.id, { success: true });
    }

    private sendResponse(id: string | number, result: unknown): void {
        const response: JsonRpcResponse = {
            jsonrpc: '2.0',
            id,
            result,
        };
        this.postMessage(response);
    }

    private sendError(id: string | number, code: number, message: string): void {
        const response: JsonRpcResponse = {
            jsonrpc: '2.0',
            id,
            error: { code, message },
        };
        this.postMessage(response);
    }

    /**
     * Send a notification to the iframe (no response expected).
     */
    sendNotification(method: string, params: Record<string, unknown>): void {
        const notification: JsonRpcNotification = {
            jsonrpc: '2.0',
            method,
            params,
        };
        this.postMessage(notification);
    }

    private postMessage(data: unknown): void {
        if (!this.iframe?.contentWindow) {
            const d = data as Record<string, unknown>;
            console.log(`[MCP postmessage/bridge] CANNOT SEND (no iframe.contentWindow): method=${d.method || 'response'} id=${d.id}`);
            return;
        }

        const d = data as Record<string, unknown>;
        console.log(`[MCP postmessage/bridge] sending: method=${d.method || 'response'} id=${d.id}`);

        // Use '*' as target origin since the iframe is sandboxed (srcdoc has null origin)
        this.iframe.contentWindow.postMessage(data, '*');
    }
}
