# Cloudflare Sandbox Implementation Plan

> Replace CodeSandbox with Cloudflare Sandbox SDK for cloud-hosted dev environments.

## Executive Overview

Scry IDE currently depends on CodeSandbox (CSB) for all cloud compute — running user projects, syncing files, and serving previews. This dependency has proven unstable: WebSocket disconnections drop file writes, preview URLs return 401s due to privacy settings, and the CSB Expo template uses an outdated custom server that blocks preload script injection.

**Cloudflare Sandbox SDK** is a drop-in replacement built on Cloudflare Containers. It provides the same capabilities (full Linux environment, filesystem, terminal, preview URLs) with better reliability, no per-seat cost, and an open-source SDK. The existing `Provider` abstraction in `packages/code-provider` means the swap is mostly plumbing — the CF SDK's API maps 1:1 to our Provider interface.

**Investment:** ~5-6 weeks across 5 phases. **Cost:** $5/mo base (Workers plan the user already has) + ~$0.18/hr per active sandbox. **Risk:** CF Sandbox is in public beta — CSB stays as fallback until CF stabilizes.

The plan delivers:
1. Stable file sync (no more WebSocket drops)
2. Auto-generated public preview URLs (no 401s)
3. Custom container images (Expo + Next.js pre-installed, preload scripts baked in)
4. Zero per-seat pricing for multi-user scaling
5. Path to self-managed infrastructure via open-source SDK

## Why

- CSB WebSocket instability causes file sync failures and reconnection loops
- CSB sandbox privacy issues (401 errors on preview URLs)
- CSB custom Express server template doesn't serve web/index.html (preload script workaround needed)
- Per-seat pricing ($12/mo Pro) vs CF usage-based ($5/mo base)
- CF Sandbox has open-source SDK, auto-generated preview URLs, xterm.js terminal support

## Architecture

```
Onlook Editor (Browser)
    |
    |--- tRPC API (Server)
    |       |
    |       |--- CF Sandbox SDK (create, manage containers)
    |       |--- Container lifecycle (start, stop, pause)
    |       |--- Preview URL management
    |
    |--- WebSocket (Browser → CF Container)
            |
            |--- File read/write
            |--- Terminal (PTY)
            |--- File watching
            |--- Dev server output
```

## Prerequisites

- [ ] Cloudflare Workers paid plan ($5/mo) — user already has this
- [ ] Cloudflare API token with Container permissions
- [ ] Custom container image with Node.js + Expo + Next.js

## Phase 1: Provider Skeleton (1 week)

### 1.1 Add CloudflareProvider to enum
```typescript
// packages/code-provider/src/providers.ts
export enum CodeProvider {
    CodeSandbox = 'code_sandbox',
    Cloudflare = 'cloudflare',  // NEW
    NodeFs = 'node_fs',
    // ...
}
```

### 1.2 Create provider directory
```
packages/code-provider/src/providers/cloudflare/
├── index.ts          # CloudflareSandboxProvider class
├── types.ts          # CF-specific types
└── utils/
    ├── files.ts      # File operations
    ├── terminal.ts   # Terminal/PTY wrapper
    └── preview.ts    # Preview URL helpers
```

### 1.3 Install CF Sandbox SDK
```bash
cd packages/code-provider
bun add @cloudflare/sandbox-sdk
```

### 1.4 Implement CloudflareSandboxProvider
The CF Sandbox SDK maps 1:1 to the Provider interface:

| Provider Method | CF Sandbox SDK |
|----------------|----------------|
| `readFile` | `sandbox.files.read()` |
| `writeFile` | `sandbox.files.write()` |
| `listFiles` | `sandbox.files.list()` |
| `deleteFiles` | `sandbox.files.remove()` |
| `createDirectory` | `sandbox.files.mkdir()` |
| `watchFiles` | `sandbox.files.watch()` |
| `createTerminal` | `sandbox.terminal.create()` |
| `runCommand` | `sandbox.commands.run()` |
| `getTask` | `sandbox.processes.get()` |
| `ping` | `sandbox.status()` |
| `destroy` | `sandbox.stop()` |

### 1.5 Update factory
```typescript
// packages/code-provider/src/index.ts
if (codeProvider === CodeProvider.Cloudflare) {
    return new CloudflareSandboxProvider(providerOptions.cloudflare!);
}
```

## Phase 2: Container Image (1 week)

### 2.1 Create Dockerfile
```dockerfile
FROM node:20-slim

# Install common tools
RUN apt-get update && apt-get install -y git curl && rm -rf /var/lib/apt/lists/*
RUN npm install -g expo-cli

# Pre-install Onlook preload script
COPY onlook-preload-script.js /opt/onlook/

WORKDIR /workspace
```

### 2.2 Template images
Create two variants:
- `scry-expo:latest` — Node.js + Expo CLI + react-native-web
- `scry-nextjs:latest` — Node.js + Next.js

### 2.3 Push to CF Container Registry
```bash
wrangler containers push scry-expo:latest
wrangler containers push scry-nextjs:latest
```

## Phase 3: Server Integration (1-2 weeks)

### 3.1 Add CF env vars
```env
CLOUDFLARE_SANDBOX_API_TOKEN=xxx
CLOUDFLARE_ACCOUNT_ID=xxx
```

### 3.2 Update env.ts
```typescript
// apps/web/client/src/env.ts
server: {
    CLOUDFLARE_SANDBOX_API_TOKEN: z.string().optional(),
    CLOUDFLARE_ACCOUNT_ID: z.string().optional(),
}
```

### 3.3 Add tRPC routes for CF sandbox
```typescript
// apps/web/client/src/server/api/routers/project/sandbox.ts
createCloudflare: protectedProcedure
    .input(z.object({
        template: z.enum(['expo', 'nextjs']),
        name: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
        const sandbox = await cfSdk.sandbox.create({
            image: input.template === 'expo' ? 'scry-expo:latest' : 'scry-nextjs:latest',
        });
        
        // Scaffold project inside container
        await sandbox.commands.run(`npx create-expo-app /workspace --template blank`);
        await sandbox.commands.run('cd /workspace && npm install');
        
        // Start dev server
        await sandbox.processes.start('dev', 'npx expo start --web --port 8081');
        
        return {
            sandboxId: sandbox.id,
            previewUrl: sandbox.getPreviewUrl(8081),
        };
    }),
```

### 3.4 Database migration
Add `providerType` column to `branches` table:
```sql
ALTER TABLE branches ADD COLUMN provider_type VARCHAR DEFAULT 'code_sandbox';
```

### 3.5 Session manager routing
```typescript
// session.ts
async start(sandboxId: string, providerType: CodeProvider) {
    if (providerType === CodeProvider.Cloudflare) {
        provider = await createCodeProviderClient(CodeProvider.Cloudflare, {
            providerOptions: { cloudflare: { sandboxId } },
        });
    } else {
        // existing CSB logic
    }
}
```

## Phase 4: Frontend Integration (1 week)

### 4.1 Provider selector in Create dropdown
```
Create ▾
├── Next.js (Cloud)           → CF Sandbox
├── Expo / RN (Cloud)         → CF Sandbox
├── Next.js (CodeSandbox)     → CSB (legacy)
├── Expo / RN (CodeSandbox)   → CSB (legacy)
└── Import Project
```

### 4.2 Preview URL handling
CF auto-generates preview URLs. Update `getSandboxPreviewUrl`:
```typescript
function getPreviewUrl(providerType: CodeProvider, sandboxId: string, port: number) {
    if (providerType === CodeProvider.Cloudflare) {
        return sandbox.getPreviewUrl(port); // CF SDK handles this
    }
    return `https://${sandboxId}-${port}.csb.app`;
}
```

### 4.3 Terminal integration
CF terminal uses WebSocket — same as CSB. The existing xterm.js integration should work with minimal changes.

## Phase 5: Migration & Cleanup (1 week)

### 5.1 Feature flag
```env
NEXT_PUBLIC_ENABLED_PROVIDERS=cloudflare,codesandbox
```

### 5.2 Default to CF for new projects
Keep CSB as fallback for existing projects.

### 5.3 Migration tool
Script to migrate existing CSB projects to CF (optional, for later).

## Cost Comparison

| Usage | CF Sandbox | CSB |
|-------|-----------|-----|
| 20 hrs/mo (light) | ~$2.50 | Free (within credits) |
| 60 hrs/mo (medium) | ~$9.70 | ~$3 overage |
| 160 hrs/mo (heavy) | ~$27.70 | ~$21 (Pro + overage) |
| Per-seat cost | $0 | $12/mo |
| Base plan | $5/mo | Free/$12 |

## Risks

| Risk | Mitigation |
|------|-----------|
| CF Sandbox is public beta | Keep CSB as fallback, pin SDK version |
| Container cold start | Pre-warm containers, use snapshots if available |
| API changes | Abstract behind Provider interface |
| Preview URL format differs | Provider-specific URL generation |
| Terminal WebSocket protocol | CF uses standard WebSocket, should be compatible |

## Key Files to Modify

| File | Change |
|------|--------|
| `packages/code-provider/src/providers.ts` | Add Cloudflare to enum |
| `packages/code-provider/src/index.ts` | Add to factory |
| `packages/code-provider/src/providers/cloudflare/` | New provider |
| `packages/db/src/schema/project/branch.ts` | Add providerType column |
| `apps/web/client/src/env.ts` | Add CF env vars |
| `apps/web/client/src/server/api/routers/project/sandbox.ts` | Add CF routes |
| `apps/web/client/src/components/store/editor/sandbox/session.ts` | Route by provider |
| `apps/web/client/src/app/projects/_components/top-bar.tsx` | Provider selector |
| `packages/constants/src/csb.ts` | Generalize preview URLs |

## Timeline

| Phase | Duration | Dependency |
|-------|----------|-----------|
| Phase 1: Provider skeleton | 1 week | None |
| Phase 2: Container image | 1 week | Phase 1 |
| Phase 3: Server integration | 1-2 weeks | Phase 1 + 2 |
| Phase 4: Frontend integration | 1 week | Phase 3 |
| Phase 5: Migration & cleanup | 1 week | Phase 4 |
| **Total** | **5-6 weeks** | |
