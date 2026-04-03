# Expo Snack Provider — Parallel Task Queue

> 20 tasks across 4 phases. Up to 8 agents via git worktrees. E2E test gates between phases.

## Execution Model

```
Phase 0  ──────────────────────────────────  1 agent, sequential (contracts)
           │
Phase 1  ══╪══════════════════════════════  8 agents, parallel (implementation)
           │
Phase 2  ══╪══════════════════════════════  5 agents, parallel (integration)
           │
Phase 3  ──────────────────────────────────  1 agent, sequential (merge + e2e)
```

Each task = 1 worktree. No two tasks touch the same file.

---

## Phase 0: Contracts & Scaffolding (Sequential)

### T0.1 — Add ExpoSnack enum, types, factory stub, install SDK

**Files owned:**
- `packages/code-provider/src/providers.ts` (add `ExpoSnack = 'expo_snack'`)
- `packages/code-provider/src/providers/snack/types.ts` (NEW)
- `packages/code-provider/src/providers/snack/index.ts` (NEW — empty class stub)
- `packages/code-provider/package.json` (add `snack-sdk`)
- `packages/code-provider/src/index.ts` (add to ProviderInstanceOptions + factory)

**Types to define:**
```typescript
export interface SnackProviderOptions {
    name?: string;
    description?: string;
    sdkVersion?: string;
    initialFiles?: Record<string, { type: 'CODE'; contents: string }>;
    dependencies?: Record<string, { version: string }>;
    snackId?: string; // for loading existing snacks
}

export interface SnackSessionInfo {
    snackId: string;
    url: string; // exp:// URL for Expo Go
    webPreviewUrl: string;
    online: boolean;
}
```

**Acceptance:** `bun run typecheck` passes

---

## Phase 1: Independent Implementation (8 agents, parallel)

All Phase 1 tasks depend on T0.1 being merged.

### T1.1 — Snack Provider: File operations

**File owned:** `packages/code-provider/src/providers/snack/utils/files.ts` (NEW)

**Scope:** Helper functions that bridge Snack's file model to Provider interface:
- `readSnackFile(state, path)` → extract content from Snack state
- `writeSnackFile(snack, path, content)` → call `updateFiles()`
- `listSnackFiles(state, basePath)` → filter `Object.keys(state.files)` by prefix
- `deleteSnackFile(snack, path)` → `updateFiles({ [path]: null })`
- `renameSnackFile(snack, oldPath, newPath)` → read + delete + write
- `snackFilesToTree(files)` → convert flat file map to directory tree

**Test:** Unit test in `__tests__/files.test.ts`
**Acceptance:** `bun test packages/code-provider/src/providers/snack/utils/__tests__/files.test.ts`

---

### T1.2 — Snack Provider: Dependency management utility

**File owned:** `packages/code-provider/src/providers/snack/utils/dependencies.ts` (NEW)

**Scope:**
- `parsePackageJson(content)` → extract dependencies
- `updateSnackDeps(snack, deps)` → call `updateDependencies()`
- `detectMissingDeps(state)` → check for missing peer deps from state
- `depsFromGitHubPackageJson(repoUrl, branch)` → fetch + parse package.json from GitHub

**Test:** Unit test
**Acceptance:** Unit tests pass

---

### T1.3 — Snack Provider: Log/console terminal adapter

**File owned:** `packages/code-provider/src/providers/snack/utils/terminal.ts` (NEW)

**Scope:** Since Snack has no shell, create a `SnackLogTerminal extends ProviderTerminal` that streams console output from Snack's log listener:
- `open()` → start listening to `snack.addLogListener()`
- `write(data)` → no-op or evaluate JS in Snack context
- `run(command)` → return "Command execution not available in Snack"
- `kill()` → remove listener
- `onOutput(cb)` → forward log messages

Also `SnackLogTask extends ProviderTask`:
- `open()` → return current log buffer
- `run()` → `snack.reloadConnectedClients()`
- `restart()` → reload
- `stop()` → no-op
- `onOutput(cb)` → forward log/error events

**Test:** Unit test with mock Snack
**Acceptance:** Unit tests pass

---

### T1.4 — Snack Provider: File watcher (state listener)

**File owned:** `packages/code-provider/src/providers/snack/utils/watcher.ts` (NEW)

**Scope:** `SnackFileWatcher extends ProviderFileWatcher`:
- `start()` → `snack.addStateListener()`, diff previous vs current file keys
- `stop()` → remove state listener
- `registerEventCallback(cb)` → forward add/change/remove events

**Test:** Unit test
**Acceptance:** Unit tests pass

---

### T1.5 — GitHub repo → Snack files fetcher

**File owned:** `packages/code-provider/src/providers/snack/utils/github.ts` (NEW)

**Scope:**
- `fetchGitHubRepoAsSnackFiles(repoUrl, branch)` → fetch repo tree via GitHub API, fetch each file, return `Record<string, SnackFile>`
- `isCodeFile(path)` → filter out binaries, node_modules, etc.
- `parseGitHubUrl(url)` → extract owner/repo from URL
- Handle rate limiting with retry

**Test:** Unit test with mocked fetch
**Acceptance:** Unit tests pass

---

### T1.6 — Snack preview URL utilities

**File owned:** `packages/code-provider/src/providers/snack/utils/preview.ts` (NEW)

**Scope:**
- `getSnackWebPreviewUrl(snackId, sdkVersion)` → `https://snack.expo.dev/embedded/@snack/{id}`
- `getSnackExpoGoUrl(snack)` → `await snack.getUrlAsync()`
- `isSnackPreviewReady(url)` → fetch check
- `getSnackQrCodeData(url)` → return URL string for QR code component

**Test:** Unit test
**Acceptance:** Unit tests pass

---

### T1.7 — Snack constants and template config

**File owned:** `packages/constants/src/snack.ts` (NEW)

**Scope:**
```typescript
export const SNACK_DEFAULT_SDK_VERSION = '52.0.0';
export const SNACK_WEB_PLAYER_URL = 'https://snack.expo.dev/embedded';

export const SNACK_TEMPLATES = {
    blank: {
        files: { 'App.tsx': { type: 'CODE', contents: '...' } },
        dependencies: { expo: { version: '~52.0.0' } },
    },
    withNavigation: { ... },
} as const;

export function getSnackPreviewUrl(snackId: string): string;
```

Also update `packages/constants/src/index.ts` barrel export.

**Test:** Unit test
**Acceptance:** Unit tests pass

---

### T1.8 — E2E test infrastructure for Snack

**File owned:** `apps/web/client/e2e/snack/smoke.spec.ts` (NEW)

**Scope:** Test fixtures and smoke tests:
- Mock Snack SDK for offline testing
- `createMockSnack()` → returns mock with state/listeners
- Smoke test that mock Snack creation works
- Test file CRUD operations via mock

**Acceptance:** `bun test apps/web/client/e2e/snack/smoke.spec.ts` passes

---

## Phase 2: Integration (5 agents, parallel)

### T2.1 — Snack Provider main class

**Depends on:** T1.1, T1.2, T1.3, T1.4
**File owned:** `packages/code-provider/src/providers/snack/index.ts`

**Scope:** Full `SnackProvider extends Provider` using Phase 1 utils:
- Constructor takes `SnackProviderOptions`
- `initialize()` → create `new Snack({...})`, call `setOnline(true)`
- File operations → delegate to utils/files.ts
- Terminal → return SnackLogTerminal
- `watchFiles()` → return SnackFileWatcher
- `ping()` → check `getState().online`
- `destroy()` → `snack.stopAsync()`
- `runCommand()` → return "not available" message
- Static `createProject()` / `createProjectFromGit()` using GitHub fetcher

**Test:** Unit tests mocking Snack SDK
**Acceptance:** `bun run typecheck` + unit tests pass

---

### T2.2 — Factory wiring

**Depends on:** T2.1
**File owned:** `packages/code-provider/src/index.ts`

**Scope:** Wire SnackProvider into factory (same pattern as T0.1 stub but with real implementation):
- Import SnackProvider
- Add to `ProviderInstanceOptions`
- Add to `newProviderInstance()`
- Add to `getStaticCodeProvider()`

**Acceptance:** `bun run typecheck` passes

---

### T2.3 — Session manager: Route snack- prefix

**Depends on:** T2.1
**File owned:** `apps/web/client/src/components/store/editor/sandbox/session.ts`

**Scope:** Add Snack routing to `start()`:
- Detect `snack-` prefix on sandboxId
- Create SnackProvider with options
- Existing CSB/NodeFs paths unchanged

**Acceptance:** `bun run typecheck` passes

---

### T2.4 — Frontend: Add "Expo (Snack)" to Create dropdown

**Depends on:** T1.7
**File owned:** `apps/web/client/src/app/projects/_components/top-bar.tsx`

**Scope:**
- Add handler `handleCreateSnackProject()`
- No tRPC needed — Snack is client-side
- Create Snack instance, save to DB with `snack-{id}` sandboxId
- Add dropdown item with green theme

**Acceptance:** `bun run typecheck` passes

---

### T2.5 — E2E tests: Provider operations + create flow

**Depends on:** T2.1, T1.8
**Files owned:**
- `apps/web/client/e2e/snack/provider-ops.spec.ts` (NEW)
- `apps/web/client/e2e/snack/create-flow.spec.ts` (NEW)

**Scope:**
- Test file read/write/list/delete via SnackProvider with mock
- Test create project flow data contracts
- Test GitHub repo → Snack files conversion
- Test dependency management

**Acceptance:** `bun test apps/web/client/e2e/snack/` passes

---

## Phase 3: Final Integration & Validation (Sequential)

### T3.1 — Preview URL integration

**Depends on:** T2.1, T2.4
**Files owned:** Preview URL components that resolve sandbox URLs

**Scope:**
- Route `snack-` sandbox IDs to Snack web player URL
- Wire `getSnackExpoGoUrl()` into existing QR button component
- Preview iframe uses `https://snack.expo.dev/embedded/...`

---

### T3.2 — Merge all + full e2e suite

**Depends on:** All Phase 2 tasks

**Scope:**
1. Merge worktrees in order: P0 → P1 → P2
2. Run full validation: `bun run typecheck && bun test`
3. Verify CSB regression (existing Next.js flow still works)
4. Verify Snack flow: create → edit → preview

---

## Dependency Graph (DAG)

```
T0.1 ──┬→ T1.1 ─┐
       ├→ T1.2 ─┤
       ├→ T1.3 ─┼→ T2.1 → T2.2 → T3.1
       ├→ T1.4 ─┘    │
       ├→ T1.5        ├→ T2.3
       ├→ T1.6        │
       ├→ T1.7 ──→ T2.4
       └→ T1.8 ──→ T2.5 ──→ T3.2
```

## Concurrency Schedule

| Phase | Agents | Wall time |
|-------|--------|-----------|
| P0    | 1      | ~20 min   |
| P1    | 8      | ~40 min   |
| P2    | 5      | ~45 min   |
| P3    | 1      | ~20 min   |
| **Total** | — | **~2 hrs** |
