# Multi-Provider Sandbox Implementation Plan

> Scry IDE — Moving beyond CodeSandbox to support multiple sandbox providers for Expo/React Native and Next.js development.

## Current State

- All compute is handled by **CodeSandbox Devboxes** (proprietary microVMs)
- Provider abstraction exists in `packages/code-provider/` with `Provider` abstract class
- `CodeProvider` enum lists 6 providers but only CSB is implemented
- `NodeFsProvider` stub exists but is empty
- CSB WebSocket connection is unstable (writes fail during reconnection)
- No self-host or local-only option

## Target Architecture

```
                          +-----------------------+
                          |    Scry IDE (Web/Desktop)    |
                          |    Provider Interface        |
                          +----------+------------+
                                     |
              +----------------------+----------------------+
              |                      |                      |
    +---------v--------+   +---------v--------+   +---------v--------+
    | CloudflareProvider|   |  DockerProvider   |   |  NodeFsProvider   |
    | (CF Sandbox SDK)  |   |  (dockerode)      |   |  (local fs)       |
    +------------------+   +------------------+   +------------------+
    | Cloud-hosted      |   | Local containers  |   | Direct on machine |
    | Full Linux env    |   | Full Linux env    |   | No isolation      |
    | Auto preview URLs |   | localhost:PORT    |   | localhost:PORT    |
    | $0.18/hr          |   | Free (your HW)   |   | Free              |
    +------------------+   +------------------+   +------------------+
```

## Provider Comparison

| | CF Sandbox | Docker | Local (NodeFs) |
|---|---|---|---|
| **Base cost** | $5/mo (Workers plan) | Free | Free |
| **Per-hour cost** | ~$0.18/hr | Your electricity | Free |
| **Free included** | ~6 hrs/mo | Unlimited | Unlimited |
| **Isolation** | Full container | Full container | None |
| **Startup time** | Seconds | Seconds | Instant |
| **Preview URLs** | Auto-generated | localhost | localhost |
| **Can run Metro** | Yes | Yes | Yes |
| **Requires install** | No | Docker/OrbStack | Node.js |
| **Offline capable** | No | Yes | Yes |
| **Best for** | Hosted web app | Local dev + isolation | Quick local dev |

## CodeSandbox vs Cloudflare Sandbox

| | CF Sandbox | CSB |
|---|---|---|
| **Cost model** | Usage-based ($0.18/hr) | Credit-based (~$0.15/hr) |
| **Per-seat cost** | None | $12/mo on Pro |
| **Free tier** | ~6 hrs/mo (on $5 Workers plan) | ~40 hrs/mo |
| **Custom images** | Yes | No |
| **Open-source SDK** | Yes | No |
| **Snapshot/resume** | No | Yes (500ms) |
| **Global edge** | Yes (300+ locations) | Limited |
| **Stability** | Public beta | Production |
| **Self-host** | No (but SDK is open source) | No |

## Dynamic Workers (Preview/Deployment Layer)

Cloudflare Dynamic Workers are V8 isolates (not containers). They can't run Metro/dev servers but are perfect for serving built output.

**Use case:** Instant shareable previews and deployment

```
User edits code in Scry
    |
    v
npx expo export --platform web    (static HTML/JS/CSS)
    |
    v
Upload to Dynamic Worker           (or CF Pages/R2)
    |
    v
Preview URL = worker URL            (instant, global, shareable)
```

**Also possible:** Self-hosted OTA update server for native Expo previews using the Expo Updates protocol. A Dynamic Worker serves the manifest + assets, and dev builds with `expo-updates` fetch from it.

## Phased Implementation

### Phase 0: Decouple CSB Assumptions (1 week)

**Goal:** Remove hardcoded CodeSandbox references so new providers can plug in.

#### 0.1 Database migration
- Add `providerType` column to `branches` table (`varchar`, default `'code_sandbox'`)
- All existing rows default to CSB

#### 0.2 Make CSB_API_KEY optional
- In `apps/web/client/src/env.ts`: change from `z.string()` to `z.string().optional()`
- Only required when CSB provider is selected

#### 0.3 Generalize preview URL
- Move `getSandboxPreviewUrl()` to be provider-specific
- Each provider returns its own preview URL format
- CSB: `https://{id}-{port}.csb.app`
- Docker: `http://localhost:{hostPort}`
- CF Sandbox: auto-generated URL from SDK
- NodeFs: `http://localhost:{port}`

#### 0.4 Refactor hardcoded provider selection
Files with hardcoded `CodeProvider.CodeSandbox`:
- `apps/web/client/src/components/store/editor/sandbox/session.ts` (line 32)
- `apps/web/client/src/server/api/routers/project/branch.ts` (3 places)
- `apps/web/client/src/app/projects/import/local/_context/index.tsx` (line 138)
- Read provider type from branch/project config instead

#### 0.5 Extend ProviderInstanceOptions
- Add option types for Docker and Cloudflare in `packages/code-provider/src/index.ts`
- Update factory `newProviderInstance()` to handle new providers

#### 0.6 Feature flag
- Add `NEXT_PUBLIC_ENABLED_PROVIDERS` env var (comma-separated)
- Controls which providers appear in the UI

### Phase 1: NodeFs Provider — Local Filesystem (1-2 weeks)

**Goal:** Run projects directly on the user's machine. Quickest win.

#### 1.1 Dependencies
```
packages/code-provider/package.json:
  + chokidar (file watching)
  + node-pty (terminal PTY)
```

#### 1.2 File operations
Replace stubs in `packages/code-provider/src/providers/nodefs/index.ts`:
- `writeFile` → `fs.writeFile()` + `mkdir -p` for parents
- `readFile` → `fs.readFile()`, detect binary vs text
- `listFiles` → `fs.readdir()` with `withFileTypes: true`
- `statFile` → `fs.stat()`
- `deleteFiles` → `fs.rm({ recursive: true })`
- `renameFile` → `fs.rename()`
- `copyFiles` → `fs.cp({ recursive: true })`
- `createDirectory` → `fs.mkdir({ recursive: true })`

#### 1.3 File watching
- Use `chokidar.watch()` with exclude patterns
- Map events (`add`, `change`, `unlink`) to `WatchEvent`
- Implement `NodeFsFileWatcher.stop()`

#### 1.4 Terminal
- Use `node-pty` to spawn PTY shell
- `open()` → spawn `/bin/zsh` or `/bin/bash`
- `write()` → write to PTY stdin
- `onOutput()` → listen to PTY data events
- `kill()` → kill PTY process

#### 1.5 Dev server management
- `createProject` → copy template files or `git clone`
- Start dev server via terminal (`npx expo start --web`)
- Preview URL = `http://localhost:{port}`

#### 1.6 UI integration
- Add "Local" option in Create dropdown
- Auto-detect available providers on startup

### Phase 2: Docker Provider — Local Containers (2-3 weeks)

**Goal:** Isolated local development with reproducible environments.

#### 2.1 Dependencies
```
packages/code-provider/package.json:
  + dockerode
```

#### 2.2 Add `CodeProvider.Docker` to enum

#### 2.3 Implementation strategy
- Mount project dir as Docker volume
- File operations use host `fs` APIs against mounted path
- Dev server runs inside container
- Terminal via `dockerode.exec({ Tty: true })`

#### 2.4 Container image
```dockerfile
FROM node:20-slim
RUN npm install -g expo-cli
WORKDIR /workspace
# No CMD — stays alive via exec
```

#### 2.5 Port management
- Simple port allocator utility
- Track allocated ports in memory
- Find available ports from base (e.g., 10000)
- Release on container stop/destroy

#### 2.6 Provider methods
- `initialize()` → connect to Docker socket, verify Docker running
- `createProject()` → pull image, create container with volume, start
- `writeFile/readFile` → delegate to `fs` on mounted volume
- `watchFiles` → chokidar on host-mounted volume
- `createTerminal` → `dockerode.exec({ Tty: true })`
- `pauseProject` → `docker.container.pause()`
- `stopProject` → `docker.container.stop()`
- `destroy` → `docker.container.remove()`
- Preview URL = `http://localhost:{mappedHostPort}`

### Phase 3: Cloudflare Sandbox Provider (2-3 weeks)

**Goal:** Cloud-hosted alternative to CodeSandbox.

#### 3.1 Dependencies
```
packages/code-provider/package.json:
  + @cloudflare/sandbox-sdk
```

#### 3.2 Add `CodeProvider.Cloudflare` to enum

#### 3.3 Implementation
The CF Sandbox SDK already provides APIs that map 1:1 to the Provider interface:
- Filesystem: `sandbox.files.read()`, `sandbox.files.write()`
- Terminal: WebSocket PTY connections (xterm.js compatible)
- Commands: `sandbox.commands.run()` with streaming output
- Preview URLs: auto-generated by CF
- Process management: background processes for dev server

#### 3.4 Container image
- Custom Dockerfile with Node.js + Expo pre-installed
- Bake in preload scripts and common dependencies
- Push to CF container registry

#### 3.5 Auth
- CF API token for container management (server-side)
- Store in env: `CLOUDFLARE_SANDBOX_API_TOKEN`

#### 3.6 Session management
- Container ID = sandbox ID
- Store in `branches.sandboxId` column (same as CSB)
- `providerType = 'cloudflare'` in branches table

### Phase 4: Dynamic Workers for Previews (2 weeks)

**Goal:** Instant shareable previews without running a full dev server.

#### 4.1 Build pipeline
- On save/publish: run `npx expo export --platform web`
- Bundle output with `@cloudflare/worker-bundler`
- Upload to Dynamic Worker via `env.LOADER.load()`

#### 4.2 Preview URL
- Each preview gets a unique URL on CF's edge network
- Shareable, globally fast, no dev server needed
- Can embed in iframe for preview mode

#### 4.3 OTA updates for native (optional)
- Implement Expo Updates protocol server as a Worker
- Serve manifest + JS bundles
- Dev builds with `expo-updates` configured can load from it

## Key Files to Modify

| File | Change |
|------|--------|
| `packages/code-provider/src/providers.ts` | Add Docker, Cloudflare to enum |
| `packages/code-provider/src/index.ts` | Extend factory for new providers |
| `packages/code-provider/src/types.ts` | No changes needed (interface is stable) |
| `packages/code-provider/src/providers/nodefs/` | Full implementation |
| `packages/code-provider/src/providers/docker/` | New directory |
| `packages/code-provider/src/providers/cloudflare/` | New directory |
| `packages/db/src/schema/project/branch.ts` | Add `providerType` column |
| `packages/constants/src/csb.ts` | Generalize to multi-provider |
| `apps/web/client/src/env.ts` | Make CSB_API_KEY optional, add CF token |
| `apps/web/client/src/components/store/editor/sandbox/session.ts` | Read provider from config |
| `apps/web/client/src/server/api/routers/project/sandbox.ts` | Route by provider type |
| `apps/web/client/src/server/api/routers/project/branch.ts` | Remove hardcoded CSB |
| `apps/web/client/src/app/projects/_components/top-bar.tsx` | Add provider selector |

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| `node-pty` incompatible with Bun | Test early; fallback to `Bun.spawn` with manual PTY |
| Docker not installed on user's machine | Detect at runtime, show install instructions, fall back to NodeFs |
| CF Sandbox API changes (public beta) | Pin SDK version, abstract behind Provider interface |
| Volume mount perf on macOS Docker | Recommend OrbStack; use VirtioFS |
| CSB_API_KEY becoming optional breaks deploys | Default to CSB if env var present |
| Multiple providers = more maintenance | Provider interface is stable; implementations are isolated |

## Priority Order

1. **Phase 0** — Decouple CSB (unblocks everything else)
2. **Phase 3** — CF Sandbox Provider (best hosted CSB replacement)
3. **Phase 1** — NodeFs Provider (best local/desktop option)
4. **Phase 2** — Docker Provider (isolation for local dev)
5. **Phase 4** — Dynamic Workers previews (shareable previews)

Phase 3 is prioritized over Phase 1 because the hosted web app is the primary distribution — local is a secondary option for power users.
