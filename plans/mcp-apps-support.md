# MCP Apps UI Support for Onlook (Scry IDE)

## Context

Onlook currently has **no MCP support**. Its AI chat uses Vercel AI SDK `streamText()` with a custom tool system where:
- Tools are **declaration-only** on the server (no `execute` function in `BaseTool.getAITool()`)
- All tool execution happens **client-side** in the browser via `handleToolCall()` + `onToolCall`
- Tool results render in chat via `ToolCallDisplay` with pattern-matched specialized renderers

The [MCP Apps extension (SEP-1865)](https://blog.modelcontextprotocol.io/posts/2026-01-26-mcp-apps/) allows MCP tools to return interactive UI: dashboards, forms, visualizations rendered in sandboxed iframes. The Vercel AI SDK already supports MCP via `createMCPClient()` which returns tools **with `execute` functions** that run server-side.

**Goal**: Add MCP server support to Onlook so that (1) external MCP tools can be used alongside native tools in chat, and (2) MCP tools that declare UI resources render interactive sandboxed iframes inline in the chat.

---

## Architecture: Dual Execution Model

The key insight is that the AI SDK already handles the split:
- **Native Onlook tools**: No `execute` fn → SDK emits `tool-call` part → client intercepts via `onToolCall` → executes in browser
- **MCP tools**: Have `execute` fn → SDK runs them server-side during `streamText()` → result streams back automatically

Merging both tool sets into `streamText({ tools: { ...nativeTools, ...mcpTools } })` **just works** with no special routing.

---

## Phase 1: Data Model & Configuration

### 1a. `MCPServerConfig` type
**File**: `packages/models/src/project/settings.ts`

```ts
export interface MCPServerConfig {
  id: string;
  name: string;
  transport: 'sse' | 'http';
  url: string;
  apiKey?: string;
  enabled: boolean;
}

export interface ProjectSettings {
  commands: Commands;
  mcpServers?: MCPServerConfig[];  // new
}
```

### 1b. Database schema
**File**: `packages/db/src/schema/project/settings.ts`
- Add `mcpServers` JSONB column to project settings table
- Update mappers in `packages/db/src/mappers/project/settings.ts`

### 1c. Settings UI
**File**: New `McpServersTab` component in settings modal at
`apps/web/client/src/components/ui/settings-modal/project/`
- List configured servers with name, URL, enabled toggle
- Add/remove server form
- "Test Connection" button → tRPC endpoint that creates temp MCP client + calls `listTools()`

---

## Phase 2: MCP Client Integration (Server-Side)

### 2a. MCP Client Manager
**New file**: `packages/ai/src/mcp/client-manager.ts`
**New dependency**: `@ai-sdk/mcp` added to `packages/ai/package.json`

```ts
export async function createMCPClients(configs: MCPServerConfig[]): Promise<MCPClientHandle[]>
export async function getMCPToolSet(clients: MCPClientHandle[]): Promise<ToolSet>
export async function closeMCPClients(clients: MCPClientHandle[]): Promise<void>
```

- Uses `createMCPClient({ transport: { type, url, headers } })`
- Prefixes tool names with server name to avoid collisions: `mcp_<servername>_<toolname>`
- Catches per-server errors gracefully

### 2b. Update `createRootAgentStream()`
**File**: `packages/ai/src/agents/root.ts`

- Make function `async`
- Accept new `mcpServers?: MCPServerConfig[]` param
- Create MCP clients, get MCP tools, merge with native tools
- Return `{ stream, cleanup }` instead of bare stream

### 2c. Update chat route
**File**: `apps/web/client/src/app/api/chat/route.ts`

- Fetch project's MCP server configs from settings
- Pass `mcpServers` to `createRootAgentStream()`
- Call `cleanup()` in `onFinish`

### 2d. Update client-side tool handler
**File**: `apps/web/client/src/components/tools/tools.ts`

- Skip tools with `mcp_` prefix in `handleToolCall()`

---

## Phase 3: MCP Apps UI Rendering

### 3a. Detection utility
**New file**: `apps/web/client/src/app/project/[id]/_components/right-panel/chat-tab/code-display/mcp-app-utils.ts`

### 3b. `McpAppDisplay` container
**New file**: `apps/web/client/src/app/project/[id]/_components/right-panel/chat-tab/code-display/mcp-app-display.tsx`

### 3c. `McpAppSandbox` iframe
**New file**: `apps/web/client/src/app/project/[id]/_components/right-panel/chat-tab/code-display/mcp-app-sandbox.tsx`

Strict sandbox: `sandbox="allow-scripts"` only. No `allow-same-origin`, no forms, no popups.

### 3d. `McpAppBridge` (JSON-RPC over postMessage)
**New file**: `apps/web/client/src/components/store/editor/chat/mcp-app-bridge.ts`

### 3e. Integrate into `ToolCallDisplay`
**File**: `apps/web/client/src/app/project/[id]/_components/right-panel/chat-tab/chat-messages/message-content/tool-call-display.tsx`

---

## Phase 4: AI SDK Version Alignment

Align `ai` package to `5.0.60` in both `packages/ai` and `apps/web/client` before adding `@ai-sdk/mcp`.

---

## Security Model (Defense in Depth)

| Layer | Mechanism |
|-------|-----------|
| 1. Iframe sandbox | `sandbox="allow-scripts"` only |
| 2. CSP | `script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'` |
| 3. Origin validation | postMessage origin checked against expected MCP server origin |
| 4. Method whitelist | Only 3 JSON-RPC methods accepted |
| 5. User consent | `callServerTool` requires AlertDialog approval |
| 6. Auditing | All JSON-RPC messages logged (dev mode) |

---

## Implementation Order

| Step | Area | Files |
|------|------|-------|
| 1 | AI SDK version alignment | `packages/ai/package.json`, `apps/web/client/package.json` |
| 2 | Data model | `packages/models/src/project/settings.ts` |
| 3 | DB schema | `packages/db/src/schema/project/settings.ts`, mappers |
| 4 | MCP Client Manager | New: `packages/ai/src/mcp/client-manager.ts` |
| 5 | Agent stream integration | `packages/ai/src/agents/root.ts` |
| 6 | Chat route | `apps/web/client/src/app/api/chat/route.ts` |
| 7 | Client-side skip | `apps/web/client/src/components/tools/tools.ts` |
| 8 | Settings UI | New: `McpServersTab` in settings modal |
| 9 | MCP App utils/types | New: `mcp-app-utils.ts` |
| 10 | MCP App iframe | New: `mcp-app-sandbox.tsx`, `mcp-app-display.tsx` |
| 11 | JSON-RPC bridge | New: `mcp-app-bridge.ts` |
| 12 | ToolCallDisplay integration | `tool-call-display.tsx` |
