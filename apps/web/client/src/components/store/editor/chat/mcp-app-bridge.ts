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

export class McpAppBridge {
    private iframe: HTMLIFrameElement | null = null;
    private toolResult: unknown;
    private messageHandler: ((event: MessageEvent) => void) | null = null;
    private contextUpdates: Array<{ type: 'text'; text: string }> = [];

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
        this.messageHandler = (event: MessageEvent) => {
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
        // Validate the message comes from our iframe
        if (!this.iframe || event.source !== this.iframe.contentWindow) {
            return;
        }

        const data = event.data;
        if (!data || data.jsonrpc !== '2.0' || !data.method || !data.id) {
            return;
        }

        const request = data as JsonRpcRequest;

        if (process.env.NODE_ENV === 'development') {
            console.log('[MCP App Bridge] Received:', request.method, request.params);
        }

        if (!ALLOWED_METHODS.includes(request.method as AllowedMethod)) {
            this.sendError(request.id, -32601, `Method not found: ${request.method}`);
            return;
        }

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
            return;
        }

        if (process.env.NODE_ENV === 'development') {
            console.log('[MCP App Bridge] Sending:', data);
        }

        // Use '*' as target origin since the iframe is sandboxed (srcdoc has null origin)
        this.iframe.contentWindow.postMessage(data, '*');
    }
}
