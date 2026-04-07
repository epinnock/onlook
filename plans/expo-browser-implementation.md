# Onlook Expo browser preview — implementation plan

**Goal:** Add a new code provider to Onlook that replaces the CodeSandbox preview pipeline with a self-hosted, browser-side Expo bundler. Same `Provider` interface, same Onlook UI, same chat agent — only the runtime under the iframe changes. Total infrastructure cost: $0 incremental on the existing $5/mo CF Workers plan.

**Status:** Adapted from `plans/implementation-plan-expo-build.md`, then revised after a code-level audit surfaced five architectural collisions with the original adaptation. See "Audit findings" below — they reshape Sprint 0/1 substantially. The browser-metro architecture itself is still viable (248/250 upstream tests pass); what changed is **how** we slot it into Onlook.

---

## Decisions locked from scoping

| Decision | Choice |
|---|---|
| Coexistence with CSB | Feature-flagged alternative — new `CodeProvider` enum entry, CSB stays intact, opt-in per branch |
| UI location | Embedded in existing project editor — reuse Monaco / file tree / chat / MobX stores. Replace what each canvas frame's iframe points at, **not** the iframe element itself |
| File backing store | The provider IS the source of truth, just like CSB. ExpoBrowser persists files in Supabase Storage and the existing `CodeFileSystem` + `CodeProviderSync` layer mirrors them locally — **no new VFS** |
| Methods browser-metro can't satisfy | Two-pronged: (1) replace shell-dependent **read paths** with provider-native or browser-native equivalents (`isomorphic-git`, in-process search). (2) For the chat agent's `runCommand`, scope the toolset to non-shell tools when ExpoBrowser is active, plus a small interceptor for `npm install` and friends |
| Branch | New branch off `main`, **remove the empty `packages/code-provider/src/providers/snack/` folder** (remnant of the unmerged `feat/expo-snack-provider` branch) before scaffolding the new provider |
| v1 scope | All four sprints — web preview, self-hosted ESM CDN, Expo Go QR, polish |
| Bundler acquisition | Extract just the bundler runtime from reactnative.run into a new workspace package `packages/browser-metro/`. Drop the editor/UI bits |

---

## Audit findings (the five collisions that reshaped this plan)

A code-level audit before Sprint 0 found five places where the first draft of this plan didn't fit Onlook's actual architecture. Each is recorded here so future readers see the reasoning rather than just the corrected design.

### Finding 1 — `runCommand` is load-bearing far outside the chat agent
The first draft assumed `runCommand` was almost exclusively a chat-agent surface, so a 6-pattern allowlist would cover it. **It isn't.** `runCommand` is called directly from:

| Caller | What it runs | File |
|---|---|---|
| `SessionManager.ping` | `echo "ping"` | `apps/web/client/src/components/store/editor/sandbox/session.ts:225` |
| `GitManager.ensureGitConfig` | `git config user.name`, `git config user.email`, `git config user.name "Onlook"` | `apps/web/client/src/components/store/editor/git/git.ts:64-77` |
| `GlobTool` | `bash -c 'shopt -s globstar... for f in ...; do ...'`, `sh -c '...'`, `find ... -type f`, `test -e`, `test -d` | `packages/ai/src/tools/classes/glob.ts:104,127,171,212,218` |
| `GrepTool` | (parallel structure to GlobTool) | `packages/ai/src/tools/classes/grep.ts` |
| `TypecheckTool` | `tsc --noEmit` | `packages/ai/src/tools/classes/typecheck.ts` |
| `BashReadTool` / `BashEditTool` | arbitrary bash | `packages/ai/src/tools/classes/bash-{read,edit}.ts` |

A 6-pattern interceptor would make ping fail (so the session looks dead), git init fail (so commits panel breaks), and the most-used read-only tools (glob/grep/typecheck) silently return errors. **Correction below in §0.4 + §1.6 + §1.7:** the answer isn't a bigger interceptor — it's swapping the *implementations* of these specific call sites for browser-native equivalents (`isomorphic-git` for git, in-process search over `CodeFileSystem` for glob/grep, in-browser TS for typecheck), and scoping the chat toolset to non-shell tools when ExpoBrowser is active.

### Finding 2 — Provider selection is per-branch, not per-project
The first draft proposed a `previewProvider` column on `project.settings`. The actual seam is per-branch:
- `SessionManager.start(sandboxId, userId, providerType?)` (`session.ts:21`) takes `sandboxId` + optional `providerType`. Today provider is detected from `sandboxId` prefix (`cf-` → Cloudflare, `/` → NodeFs, else CSB).
- `branches` table (`packages/db/src/schema/project/branch.ts:10`) has `sandboxId varchar` per branch.
- A comment at `branch.ts:30` reads: `"providerType will be added via migration when DB is ready"`. There's already a half-finished branch-level path — the column simply doesn't exist on `main` yet, and the public `Branch` model in `@onlook/models` (`packages/models/src/project/frame.ts`/branch model) doesn't expose it.
- A project can have multiple branches; one branch could be on CSB while another is on ExpoBrowser. Project-level settings can't represent that.

**Correction below in §0.5:** finish the half-built `branch.providerType` migration instead of adding a second source of truth on `project.settings`.

### Finding 3 — There is no Supabase file store; the provider is the source of truth
The first draft talked about "Supabase + browser VFS mirror." This conflated two things and got both wrong:
- **Files don't live in Supabase today.** Supabase stores project metadata, settings, branches, conversations — not file contents. Files live in the *sandbox runtime* (the CSB container, the CF sandbox, the local NodeFS).
- **Onlook already has a local mirror layer.** `CodeFileSystem` (`packages/file-system/src/code-fs.ts:32`) is an IndexedDB-backed local FS that injects preload scripts and OIDs on write. `CodeProviderSync` (`apps/web/client/src/services/sync-engine/sync-engine.ts:150`) does bidirectional sync between the provider and `CodeFileSystem`. Initialized at `apps/web/client/src/components/store/editor/sandbox/index.ts:96`.
- The first draft's "VFS" was just `CodeFileSystem` under a different name, plus an extra Supabase round-trip we didn't need.

**Correction below in §1.2:** ExpoBrowserProvider's backing store is **Supabase Storage** (the actual blob/file store, not metadata tables) keyed by `(projectId, branchId, path)`. The existing `CodeProviderSync` mirrors Supabase ↔ `CodeFileSystem` exactly the way it mirrors CSB ↔ `CodeFileSystem` today. Browser-metro reads from `CodeFileSystem` (the existing local mirror). No new VFS, no parallel sync loop.

### Finding 4 — The canvas is multi-frame and frame URLs are persisted; iframes can't use srcdoc
The first draft proposed a `BrowserMetroPreview` component with a `srcdoc`/eval iframe. The canvas is built around per-frame URLs:
- `Frame` (`packages/models/src/project/frame.ts:4-16`) has a persisted `url: string` field.
- The frame view (`apps/web/client/src/app/project/[id]/_components/canvas/frame/view.tsx:320`) renders `<WebPreviewBody src={frame.url} ...>`.
- Penpal connection (`view.tsx:285`) attaches via `iframe.contentWindow` after the iframe loads from a URL. A srcdoc iframe with eval'd bundles doesn't expose the same load lifecycle, breaks navigation history, and can't host multiple canvas frames pointing at different routes.
- A project can have many frames at different routes (`/`, `/settings`, `/profile`).

**Correction below in §1.3:** instead of replacing the iframe element, **replace what `frame.url` points at**. Register a service worker in the Onlook origin that intercepts `/preview/<branchId>/<frameId>/*` requests and serves bundled HTML/JS from a `BroadcastChannel`-shared store. Each `frame.url` becomes a real same-origin URL like `https://app.onlook.com/preview/<branchId>/<frameId>/`. Penpal, navigation history, multi-frame canvas, and the existing preload-script injection all keep working unchanged.

### Finding 5 — Feature flags are env-based, not per-user
The first draft wanted a "user-level rollout flag." The actual flag system (`apps/web/client/src/lib/feature-flags.ts:5`, `apps/web/client/src/hooks/use-feature-flags.tsx:29`) reads booleans from `env.NEXT_PUBLIC_*`. **Global per deployment, not per user.**

**Correction below in §0.5:** rollout gating happens via a DB-backed `users.featureFlags` JSON column (or join table). The env-based system stays for build-time flags. The new `useExpoBrowserPreview` flag is per-user, persisted in the DB, toggleable from an internal admin route.

### Open question (acknowledged, not yet resolved)
**The agent system prompt is global and has no provider-context threading.** `getSystemPromptFromType(chatType)` (`packages/ai/src/agents/root.ts:34`) only knows the chat type. `SYSTEM_PROMPT` (`packages/ai/src/prompt/constants/system.ts:1`) is a constant string that already mentions "terminal command tool" and assumes shell is available. Threading the active branch's provider through `createRootAgentStream` and assembling the prompt dynamically is non-trivial — see §0.8 for the proposed approach.

---

## Architecture summary (Onlook-flavored, post-audit)

```
Onlook Next.js client (apps/web/client) — same shell as today
│
├── Editor surface (unchanged)
│   ├── Monaco + file tree + chat panel + canvas
│   └── CodeFileSystem (IndexedDB, per project/branch) ← unchanged local FS
│
├── SandboxManager.session (per branch)
│   └── Provider chosen from branches.providerType column (NEW, finishes existing migration)
│       ├── CodesandboxProvider (default)
│       └── ExpoBrowserProvider (new)
│            ├── readFile/writeFile/listFiles → Supabase Storage REST
│            │     (keyed by project_id/branch_id/path)
│            ├── runCommand → narrow interceptor (npm install/build/dev only)
│            ├── createTerminal/runBackgroundCommand → no-op stubs
│            ├── getTask('dev') → virtual task that calls bundler.bundle()
│            └── gitStatus → reads from CodeFileSystem via isomorphic-git
│
├── CodeProviderSync (unchanged) — bidirectional sync
│       ExpoBrowserProvider (Supabase Storage) ↔ CodeFileSystem (IndexedDB)
│       Same code path that already syncs CSB ↔ CodeFileSystem
│
├── Preview pipeline
│   ├── Service worker registered at /preview/* (NEW)
│   │     Intercepts /preview/<branchId>/<frameId>/<route>
│   │     Serves HTML shell + bundled JS from a BroadcastChannel-shared store
│   ├── browser-metro Web Worker (NEW @onlook/browser-metro package)
│   │     Reads files from CodeFileSystem
│   │     Bundles with Sucrase + module resolver + React Refresh
│   │     Pushes bundle into the BroadcastChannel
│   └── Existing canvas — unchanged
│         Each Frame's url field is set to /preview/<branchId>/<frameId>/<route>
│         <iframe src={frame.url}> works the same as today
│         Penpal click-to-edit + onlook-preload-script work unchanged
│
├── Chat agent
│   ├── Toolset assembly threads activeProvider through getToolSetFromType (NEW)
│   ├── For ExpoBrowser branches: ListFilesTool, ReadFileTool, WriteFileTool,
│   │   SearchReplaceEditTool, GlobTool*, GrepTool*, TypecheckTool*
│   │   (* = browser-native re-implementations from §1.7, NOT shell-based)
│   ├── BashReadTool/BashEditTool/TerminalCommandTool excluded for ExpoBrowser
│   └── System prompt assembled with capability declaration per provider (§0.8)
│
└── Git
    └── GitManager swaps shell-based runCommand("git ...") for isomorphic-git
        when active provider is ExpoBrowser. Operates over CodeFileSystem.

Cloudflare ($0 incremental on existing plan)
├── esm-builder Container — npm install + esbuild for uncached packages
├── esm-cache Worker + R2 "esm-packages" — permanent package cache
├── expo-relay Worker + Durable Object — Expo Go QR session relay
└── Supabase Storage bucket "expo-projects" — file persistence per branch
    (uses existing Supabase, not a new service)

User's phone (Sprint 3, optional)
└── Expo Go scans QR → fetches manifest+bundle from expo-relay
```

---

## Sprint 0 — Provider scaffolding & cleanup (Week 0, ~2 days)

**Deliverable:** A new `ExpoBrowserProvider` registered in the provider registry, gated behind a feature flag, returning sane no-ops for everything that browser-metro can't do. No bundling yet — this just proves the wiring.

### 0.1 — Branch & cleanup
- Create branch `feat/expo-browser-provider` from `main`
- Delete `packages/code-provider/src/providers/snack/` (only contains an orphaned `github.test.ts` from the unmerged Snack branch). Confirm nothing on `main` imports from it
- Confirm `snack-sdk` is **not** in `packages/code-provider/package.json` on main (it isn't — it was only added on the unmerged branch)

### 0.2 — Add provider enum & wire registry
- Add `CodeProvider.ExpoBrowser = 'expo_browser'` to `packages/code-provider/src/providers.ts:1`
- Create `packages/code-provider/src/providers/expo-browser/`:
  - `index.ts` — `ExpoBrowserProvider extends Provider` (skeleton, all methods stubbed)
  - `types.ts` — `ExpoBrowserProviderOptions` (projectId, ESM worker URL, relay URL, getFiles callback)
  - `utils/vfs.ts` — in-memory VFS (later wired to Supabase)
  - `utils/virtual-task.ts` — virtual `dev` task whose `restart()` triggers a bundle
- Wire `expo-browser` into `packages/code-provider/src/index.ts`:
  - Add to `ProviderInstanceOptions`
  - Add branch in `getStaticCodeProvider`
  - Add branch in `newProviderInstance`

### 0.3 — Method-by-method coverage table

| Provider method | ExpoBrowser implementation | Notes |
|---|---|---|
| `writeFile` / `readFile` / `listFiles` / `statFile` / `deleteFiles` / `renameFile` / `copyFiles` / `createDirectory` | Supabase Storage REST, keyed by `${projectId}/${branchId}/${path}` | The provider IS the remote. `CodeProviderSync` mirrors it into `CodeFileSystem` exactly like CSB |
| `downloadFiles` | Supabase Storage `createSignedUrl` | Reuses existing Supabase auth |
| `watchFiles` | Supabase Realtime channel scoped to the branch's storage prefix | Other tabs editing the same branch get change events |
| `createTerminal` | **Throws `PROVIDER_NO_TERMINAL`.** `SessionManager.createTerminalSessions` (Layer A change in §1.7) reads `provider.getCapabilities().supportsTerminal` and **does not call** `createTerminal` for ExpoBrowser branches. The xterm panel is hidden in the bottom UI for these branches. No fake `BrowserTerminal` class is needed. |
| `runCommand` / `runBackgroundCommand` | Narrow interceptor (§0.4 Layer C) — only `npm install/uninstall/run dev/run build` patterns succeed; everything else returns `PROVIDER_NO_SHELL`. Sprint 0 lands the hard-fail stub, Sprint 1 §1.6 adds the install/build patterns |
| `getTask({ id })` | Returns a real `ProviderTask` for `'dev'` and `'start'`. `restart()` calls `bundler.bundle()` and broadcasts a reload to the preview service worker. `open()` returns a synthetic banner like `"Browser preview ready — bundler running in Web Worker.\n"`. `onOutput` streams bundler progress events. The task panel in the bottom UI binds to this. |
| `gitStatus` | `isomorphic-git` over `CodeFileSystem` | See §1.7 |
| `getCapabilities()` (**NEW** — added to Provider abstract class) | Returns `{ supportsTerminal: false, supportsShell: false, supportsBackgroundCommands: false, supportsHibernate: false, supportsRemoteScreenshot: false }`. CSB returns all `true`. NodeFs returns `true` for shell, `false` for hibernate. Cloudflare similar. |
| `initialize` | Verify Supabase Storage bucket exists, create per-branch prefix if missing | One round-trip on session start |
| `setup` / `reload` / `reconnect` | No-op / always-true | Nothing remote to actually talk to |
| `ping` | Returns `true` synchronously | **Important:** `SessionManager.ping` (`session.ts:225`) currently calls `runCommand('echo "ping"')`. §1.7.1 swaps it for `provider.ping()` directly so it doesn't depend on the interceptor |
| `createSession` | Returns `{ type: 'expo-browser', branchId, previewOriginUrl }` | Frontend uses `previewOriginUrl` to compute `frame.url` |
| `pauseProject` / `stopProject` / `listProjects` | No-op | CF provider already returns no-op for these |
| `createProject` (static) | **Sprint 0/1 scope cut**: ExpoBrowser does NOT create new branches from scratch. Branches start as CSB (existing template/GitHub flow), then the user opts an existing branch into ExpoBrowser via the per-branch settings toggle. The branch keeps its CSB sandboxId. Pure ExpoBrowser branch creation is a Sprint 5+ task (see §0.9). |
| `destroy` | Tear down service worker registration, BroadcastChannel, browser-metro Worker, Supabase Realtime sub | Local cleanup only |

### 0.4 — Shell handling — **Decision: per-tool branch-local dispatch + narrow interceptor**
The first draft proposed a narrow `runCommand` interceptor. The first audit raised it to "intercept + scope the toolset at the chat-stream level." A second audit raised the bar again: the chat stream is **project-scoped** (no `branchId` in the request body — see `apps/web/client/src/app/api/chat/route.ts:56`), but tools are **branch-scoped** (every tool's params include `branchId`). A project can have a CSB branch and an ExpoBrowser branch open simultaneously. There is no single stream-level providerType. The corrected approach is **two layers**:

**Layer A: per-tool branch-local dispatch** (the bulk of the work)
The toolset stays uniform across the whole stream — every tool is loaded for every branch. Each tool's `handle()` method already receives `branchId`. It looks up the active branch's provider via `editorEngine.branches.getSandboxById(branchId)` and dispatches based on `provider.getCapabilities()`:

| Caller | Today | ExpoBrowser branch behavior | Where it lands |
|---|---|---|---|
| `SessionManager.ping` (`session.ts:225`) | `runCommand('echo "ping"')` | Call `provider.ping()` directly (already on the abstract class) | §1.7.1 |
| `SessionManager.createTerminalSessions` (`session.ts:139`) | Unconditionally creates both task + terminal sessions | Read `provider.getCapabilities().supportsTerminal`. For ExpoBrowser (false): create only the **task** session, skip the terminal session entirely. The xterm panel for shell input is hidden in the bottom UI. **No fake `BrowserTerminal` class is built.** | §1.7.2 |
| `GitManager.*` (`git.ts:64,77`) | `runCommand("git config ...")` etc. | `isomorphic-git` API calls operating over `CodeFileSystem`, gated on `provider.getCapabilities().supportsShell` | §1.7.3 |
| `GlobTool` (`glob.ts:104`) | `bash -c '...shopt globstar...'`, `find`, `test -e/-d` | **In-process** glob: call `getFileSystem(branchId, editorEngine)` from `packages/ai/src/tools/shared/helpers/files.ts:5` to get the local `CodeFileSystem`, walk it with `listAll()`, match with `picomatch`. **Zero provider round-trips, zero Supabase requests.** Latency stays local | §1.7.4 |
| `GrepTool` (`grep.ts`) | shell `grep -r` | **In-process**: `getFileSystem(branchId, editorEngine)`, walk `listAll()`, read each text file via `CodeFileSystem.readFile(path)`, run regex in JS | §1.7.5 |
| `TypecheckTool` (`typecheck.ts`) | `tsc --noEmit` | `getFileSystem(branchId, editorEngine)` → feed the file map into `@typescript/vfs` running in a Web Worker. v1 fallback: graceful "typecheck unavailable in browser preview" if perf is unacceptable | §1.7.6 |
| `BashReadTool` / `BashEditTool` | arbitrary bash via `runCommand` | **Each tool's `handle()` reads `provider.getCapabilities().supportsShell`. False → returns a typed `PROVIDER_NO_SHELL` error.** Tool stays in the toolset; the model sees the error and adapts on the next call | §1.7.7 |

**Why per-tool branch-local dispatch (and not stream-level toolset scoping):**
- The chat stream only knows `projectId`. There is no single authoritative branch for the stream.
- A user can have a CSB branch and an ExpoBrowser branch in the same project. The agent might call a bash tool against branch A and a glob tool against branch B in adjacent turns. Stream-level scoping would force one to break.
- Tool params **already** include `branchId`. Per-tool dispatch costs nothing extra at the call site — each `handle()` looks up the branch it's targeting and decides.
- **No threading of `providerType` through `createRootAgentStream` is needed.** Drop that idea entirely.

**Layer C: narrow interceptor for the commands that survive** (small, ~80 LOC)
`TerminalCommandTool` is the one tool we keep available even on ExpoBrowser branches, because the agent uses it to install packages and restart the dev server. Its `handle()` calls `sandbox.session.runCommand(command)`, which on an ExpoBrowser branch lands in `ExpoBrowserProvider.runCommand`. That method runs the narrow interceptor:

| Command pattern | Behavior |
|---|---|
| `npm install <pkg>` / `bun add <pkg>` / `yarn add <pkg>` | Patch `package.json` via `provider.writeFile`, prefetch through the ESM worker, return synthetic success |
| `npm uninstall <pkg>` / `bun remove <pkg>` / `yarn remove <pkg>` | Patch `package.json` via `provider.writeFile`, return synthetic success |
| `npm run dev` / `npm start` / `bun run dev` / `expo start` | Call `getTask('dev').restart()` — same path the existing reload hook uses |
| `npm run build` / `expo export` / `expo export:web` | Trigger a full bundle, return success |
| Anything else | Return `{ output: '', exitCode: 1, stderr: 'shell unavailable in browser preview mode (PROVIDER_NO_SHELL). use file edit tools instead.' }` |

**System prompt update** (lands in §0.7):
Append a single branch-conditional sentence to the global system prompt — no per-stream prompt assembly required:

```
Some branches run in browser-preview mode (ExpoBrowser provider). On those
branches, shell tools (bash_read, bash_edit) and arbitrary terminal_command
calls return PROVIDER_NO_SHELL — use file ops, glob, grep, typecheck, and
the package-management commands (`npm install`, `npm uninstall`, `npm run
dev`, `npm run build`) instead. CodeSandbox branches retain full shell.
```

**Why this is now defensible:** Layer A swaps the *implementations* (search/git/typecheck operate on the local `CodeFileSystem`, never on the provider). Layer C only handles the small set of commands `TerminalCommandTool` actually receives on ExpoBrowser branches. The combined surface is bounded and the chat-stream architecture is unchanged.

**Implementation locations:**
- Layer A: `apps/web/client/src/components/store/editor/sandbox/session.ts` (ping + capability gate on terminal creation), `apps/web/client/src/components/store/editor/git/git.ts` (isomorphic-git), `packages/ai/src/tools/classes/{glob,grep,typecheck,bash-read,bash-edit}.ts` (per-tool dispatch using `getFileSystem`)
- Layer C: `packages/code-provider/src/providers/expo-browser/utils/run-command.ts` (~80 LOC)

**Sprint 0 lands the stub:** Sprint 0 just hard-fails everything in `runCommand` with `PROVIDER_NO_SHELL` and adds `getCapabilities()` to the Provider abstract class with all four existing providers declaring their values. Layer A swaps land in §1.7. Layer C narrow interceptor lands in §1.6 once the bundler exists.

### 0.5 — Provider selection & rollout — **Decision: branch-level providerType column + DB-backed user flag + runtime project-type detection**
Audit Findings 2 and 5 (first audit) corrected the original draft. The second audit refined Finding 2 further: **`branch.projectType` does not exist** as a column. Project type is detected at runtime via `SandboxManager.getProjectType()` (`apps/web/client/src/components/store/editor/sandbox/index.ts:85`) by inspecting provider files. We use that runtime detection — **no new column for projectType.**

**Persistent: finish the half-built `branches.providerType` migration** (the only new column)
- The `branches` schema (`packages/db/src/schema/project/branch.ts:30`) already carries the comment `"providerType will be added via migration when DB is ready"`. The column doesn't exist on `main` yet.
- This sprint adds **only** the `providerType` migration: `providerType varchar` (enum-typed via Drizzle), default `'code_sandbox'`, values `code_sandbox | cloudflare | expo_browser | nodefs`.
- **No `projectType` column.** Continue using `SandboxManager.getProjectType()` runtime detection — same code path as today.
- Update the `Branch` model in `packages/models/src/project/branch.ts` (currently omits the field) to expose `providerType`.
- Update DB mapper in `packages/db/src/mappers/project/branch.ts`.
- Migration file via `bun run db:push` (do **not** run `db:gen` per CLAUDE.md).
- `SessionManager.start` (`session.ts:21`) currently takes `providerType?: CodeProvider` as a parameter. Update its caller in the branch boot path to pass `branch.providerType` from the DB. The fall-through `sandboxId.startsWith('cf-') → Cloudflare` heuristic is removed in favor of the column.
- A project can have multiple branches, each on its own provider — this matches the existing data model and means we can A/B test ExpoBrowser on a single branch without disrupting the main one.

**Rollout gate: DB-backed user feature flag (NOT env-based)**
- First-audit Finding 5: `apps/web/client/src/lib/feature-flags.ts` is env-based and global. Cannot dogfood per user.
- Add `users.featureFlags jsonb` column (or a thin `user_feature_flags` join table — pick whichever the team prefers) with a `useExpoBrowserPreview: boolean` key.
- Add a tRPC procedure `user.getFeatureFlags` returning the JSON. Expose via a new `useUserFeatureFlags` React hook (sibling to the existing `useFeatureFlags`, which stays for env flags).
- The provider-selection UI (the radio in the per-branch settings) is **hidden** unless `useUserFeatureFlags().useExpoBrowserPreview` is true. Without the flag, every branch is forced to `code_sandbox` regardless of the DB column.
- Internal admin route `/admin/feature-flags` to flip the flag for specific user emails — gated on the existing admin check.
- Post-GA: delete the user-flag check, keep the column, leave the existing env-based `feature-flags.ts` alone.

**Per-branch settings UI:**
- Add a "Preview runtime" radio in the existing settings modal (`apps/web/client/src/components/ui/settings-modal/project/index.tsx`). Visible only when **all three** are true:
  1. `useUserFeatureFlags().useExpoBrowserPreview === true`
  2. `editorEngine.branches.activeBranch.sandbox` has been booted at least once (so `SandboxManager.getProjectType()` has resolved)
  3. The resolved `projectType === ProjectType.EXPO` (from the runtime detection — same in-memory MobX state the editor already uses)
- Acceptable consequence: the toggle is invisible until the user has opened the branch once on its current provider. Document in the modal: *"Open a branch to see its preview options."*
- Changing the value triggers a branch refresh (tear down `SessionManager`, re-create with the new provider). Document in the modal: *"Active edits will be saved before switching."*
- **Critical (Position B):** the toggle only switches the **runtime** for an existing branch — it does not create a new sandbox. The branch keeps its existing CSB `sandboxId`, which lets it fall back cleanly. See §0.9 for the Position B scope cut on `sandboxId` consumers.
- No workspace or project-level setting.

### 0.6 — Audit pass: catalog every direct `runCommand` caller
**Estimate:** half a day. **Output:** a checklist appended to this section.

Before swapping anything, exhaustively grep the codebase for direct `runCommand` calls outside the chat-tool path. The audit already found six call sites (Finding 1) but the goal here is to lock the list:

- [ ] `SessionManager.ping` (`session.ts:225`) — replace with `provider.ping()`
- [ ] `GitManager.*` (`git.ts`) — every call site noted, mapped to its `isomorphic-git` equivalent
- [ ] `GlobTool` (`glob.ts:104,127,171,212,218`) — picomatch swap
- [ ] `GrepTool` — in-process regex swap
- [ ] `TypecheckTool` — `@typescript/vfs` swap (or graceful "unavailable" for v1)
- [ ] `BashReadTool` / `BashEditTool` — toolset exclusion
- [ ] `CheckErrorsTool` — verify it doesn't shell out (it might delegate to TypecheckTool)
- [ ] Any test files — mock `runCommand` with the new interceptor in tests
- [ ] Any place that pattern-matches `command` strings (e.g. `withSyncPaused` in `@/utils/git`)

Each call site gets a tracking checkbox here so Sprint 1 §1.7 has a definitive list to work through. **No code changes in this task** — this is pure discovery so we don't get surprised mid-Sprint 1.

### 0.7 — System prompt: append branch-conditional language (small)
**Estimate:** half a day. **No `createRootAgentStream` threading required.**

The second audit confirmed there's no `branchId` in the chat-stream request body — the stream is project-scoped. Threading a `providerType` through `createRootAgentStream` would be wrong because a project can have mixed-provider branches in the same stream. Instead, the system prompt gets a single unconditional appended block describing the branch-conditional behavior, and individual tools surface `PROVIDER_NO_SHELL` errors at call time (per §0.4 Layer A). The model sees the prompt language and adapts.

- Append to `SYSTEM_PROMPT` in `packages/ai/src/prompt/constants/system.ts`:

```
Some branches in this project may run in browser-preview mode (the
ExpoBrowser provider). On those branches:
- Shell tools (bash_read, bash_edit) and arbitrary terminal_command calls
  return an error code "PROVIDER_NO_SHELL". When you see that, switch to
  file operation tools (read_file, write_file, list_files) and the in-
  process search tools (glob, grep, typecheck) instead.
- terminal_command still works for: npm install <pkg>, npm uninstall <pkg>,
  npm run dev, npm run build, and the equivalent bun/yarn/expo commands.
  Use those for package management and dev server restarts.
- All other functionality (file ops, search, typecheck, git status) is
  fully available — it just runs locally instead of in a shell.

CodeSandbox branches retain a full Linux shell with no restrictions.
```

- **No** changes to `getSystemPromptFromType`, `createRootAgentStream`, or any tRPC route. The prompt is global and unconditional.
- Unit test: snapshot test that asserts the new language appears in `SYSTEM_PROMPT`.
- The actual capability check is done **at tool-call time** in §1.7 (each tool's `handle()` reads `provider.getCapabilities()` for the branch it was called against).

<details>
<summary>(Removed) Original §0.7 — superseded</summary>

The first audit's §0.7 proposed extracting `SYSTEM_PROMPT` into a function `getSystemPrompt({ providerType })` and threading `providerType` through `createRootAgentStream`. The second audit invalidated this approach: the chat stream only knows `projectId`, not `branchId`, so there is no single authoritative provider for the stream. The replacement above keeps the prompt global and pushes capability checks down to per-tool dispatch.

</details>

### 0.8 — Test 0.1: Expo Go bundle format probe (long-lead-time spike)
**Owner:** the same person doing the CF Worker apps in Sprints 2–3 (same wrangler/CF skillset).
**Estimate:** ~2 hours.

Run this in Sprint 0, **before any Sprint 3 code starts**. The result decides whether `cf-expo-relay` serves plain HTTP bundles (simple path) or has to wrap output in Metro's `__d()/__r()` format (complex path). Finding out late costs days of relay work.

Steps:
1. Spin up a throwaway CF Worker that serves a hardcoded `manifest.json` and `bundle.js` for a trivial RN component (`<View><Text>hello</Text></View>`).
2. Point Expo Go (SDK 52) at the manifest URL.
3. **No physical device needed:** Expo Go runs in the iOS Simulator (`xcrun simctl install ... ExpoGo.app`) and Android Emulator. Either works. Absolute fallback: inspect the network requests Snack makes to `snack.expo.dev` and copy the format.
4. Record one of two outcomes:
   - **Plain HTTP works** → Sprint 3 takes the simple `serveBundle` path. §4.2 (Metro format wrapper) is not needed.
   - **Metro format required** → Sprint 3 needs to ship the `__d()/__r()` wrapper from §4.2. Worker code in §3.1 picks the wrapped path.
5. Append a one-paragraph note to §3.1 of this plan with the result so Sprint 3 can pick the right path immediately.

### 0.9 — **Position B**: gate the 7 hard-coded `'code_sandbox'` consumers + disable publish UI for ExpoBrowser branches
**Estimate:** 1 day. **This is the work that lets us actually drop CSB on Day 1 for opted-in branches** instead of leaving it as a hibernated placeholder.

The second audit found that `branch.sandbox.id` is referenced in 14+ places, but only 9 of them actually depend on CSB-specific behavior. The other 5 just use it as an opaque key. Position B handles them in three groups:

**Group 1: refactor `getSandboxPreviewUrl` to take `providerType`** (~1 hour)
The helper at `packages/constants/src/csb.ts` is currently called with a hard-coded `'code_sandbox'` string at every call site:

| Call site | What it does |
|---|---|
| `apps/web/client/src/server/api/routers/project/project.ts:84` | Builds preview URL for project listing |
| `apps/web/client/src/server/api/routers/project/sandbox.ts:120,200,260` | Builds preview URLs after sandbox create/start |
| `apps/web/client/src/server/api/routers/project/branch.ts:129,274` | Builds preview URLs for branch creation |
| `apps/web/client/src/server/api/routers/project/fork.ts:74` | Builds preview URL after fork |
| `apps/web/client/src/app/projects/_components/templates/template-modal.tsx:105` | Template gallery preview |
| `apps/web/client/src/app/project/[id]/_components/bottom-bar/expo-qr-button.tsx:28` | Expo QR code URL (CSB-only feature today) |

Change `getSandboxPreviewUrl(provider: 'code_sandbox', sandboxId, port)` to accept `provider: CodeProvider` and switch internally:
- `code_sandbox` → existing behavior (CSB CDN URL)
- `cloudflare` → existing CF Sandbox URL
- `expo_browser` → `${appOrigin}/preview/${branchId}/${frameId}/` (computed from the branchId, not the sandboxId)
- `nodefs` → existing localhost URL

Update each call site to pass `branch.providerType` instead of the hard-coded string. Server-side call sites need to fetch `branch.providerType` from the DB if they don't already have it.

**Group 2: gate `hibernate`/`shutdown` on `provider.getCapabilities().supportsHibernate`** (~30 min)
- `apps/web/client/src/server/api/routers/project/sandbox.ts:193` (the `hibernate` mutation) and the parallel `shutdown` mutation: at the top of each handler, fetch the branch, read `branch.providerType`, and short-circuit with `{ ok: true }` if the provider doesn't support hibernation.
- `SessionManager.hibernate` (`session.ts:182`) currently calls `api.sandbox.hibernate.mutate({ sandboxId })` unconditionally. Same gate — check `provider.getCapabilities().supportsHibernate` before calling.

**Group 3: disable publish UI for ExpoBrowser branches** (the only feature we're cutting in v1, ~2 hours)
v1 does not migrate the publish flow. The publish dropdown in `apps/web/client/src/app/project/[id]/_components/top-bar/publish/dropdown/` (`provider.tsx`, `preview-domain-section.tsx`, `custom-domain/provider.tsx`) shows a disclaimer for ExpoBrowser branches:

> Publishing is not yet supported in browser-preview mode. To publish this branch, switch its preview runtime back to CodeSandbox in branch settings.

The dropdown items themselves are disabled (`disabled` prop on the buttons). Users on ExpoBrowser branches can still flip back to CSB at any time because the underlying `sandboxId` still exists.

**Group 4: confirm the opaque-key call sites still work** (verification, ~30 min)
These four call sites pass `branch.sandbox.id` as an opaque string and don't care what's in it:
- `apps/web/client/src/components/store/editor/sandbox/index.ts:51` — `this.session.start(this.branch.sandbox.id)` — passes to SessionManager which is provider-aware
- `apps/web/client/src/components/store/editor/sandbox/index.ts:92` — `detectProjectTypeFromProvider(provider, this.branch.sandbox.id)` — uses sandboxId as a cache key only
- `apps/web/client/src/components/store/editor/sandbox/index.ts:102` — `CodeProviderSync.getInstance(provider, this.fs, this.branch.sandbox.id, ...)` — uses as instance key
- `apps/web/client/src/components/store/editor/sandbox/index.ts:143` — `copyPreloadScriptToPublic(provider, projectType, routerConfig, this.branch.sandbox.id)` — uses as filename suffix
- `apps/web/client/src/app/project/[id]/_components/top-bar/project-breadcrumb.tsx:62` — read for display only
- `apps/web/client/src/app/project/[id]/_components/top-bar/publish/dropdown/custom-domain/provider.tsx:35` — passes to publish flow (covered by Group 3)
- `apps/web/client/src/app/project/[id]/_components/top-bar/publish/dropdown/preview-domain-section.tsx:43` — same as above

For Position B these stay unchanged. Branches that opt into ExpoBrowser keep their original CSB sandboxId, so `branch.sandbox.id` continues to be a real CSB identifier — it just isn't used for the editor/preview/agent runtime anymore. The user can flip back to CSB at any time and everything resumes from where they left off.

**Out of scope for v1 (Sprint 5+):** pure ExpoBrowser branches with no underlying CSB sandbox. Once every consumer of `sandboxId` is provider-aware (publish, screenshot, etc.), we can offer "create a new ExpoBrowser-only branch" without ever provisioning CSB. Until then, the on-ramp is "create on CSB, opt into ExpoBrowser, optionally flip back."

**Sprint 0 DoD:**
- New `feat/expo-browser-provider` branch exists, the empty `snack/` folder is gone.
- `CodeProvider.ExpoBrowser` enum and a stub `ExpoBrowserProvider` class are wired into the registry. All Provider methods stubbed; `runCommand` returns `PROVIDER_NO_SHELL` for everything.
- `Provider.getCapabilities()` added to the abstract class. CSB, Cloudflare, NodeFs, and ExpoBrowser providers all declare their values.
- `branches.providerType` migration applied via `bun run db:push`. `Branch` model and mapper exposing the new field. `SessionManager` reads from the column.
- DB-backed `users.featureFlags` schema in place. `useUserFeatureFlags` hook ready. Admin route can flip the flag.
- §0.6 audit checklist filled in — every direct `runCommand` caller is identified and has a documented swap target.
- §0.7 system prompt language appended and snapshot-tested. No `createRootAgentStream` threading.
- §0.8 Test 0.1 result recorded in §3.1.
- §0.9 Position B migration: `getSandboxPreviewUrl` is now provider-aware, all 7 call sites pass `branch.providerType`. `hibernate`/`shutdown` short-circuit for non-hibernating providers. Publish UI shows the disclaimer for ExpoBrowser branches.
- Toggling the user flag + setting a test branch's `providerType` to `expo_browser` selects the stub provider with no console errors. Preview iframe is empty (no bundler yet — that's Sprint 1). Publish dropdown shows the disclaimer. Switching back to `code_sandbox` restores normal behavior immediately.

---

## Sprint 1 — Browser-metro extraction & web preview (Week 1–2)

**Deliverable:** A user toggles the flag on, opens an Expo project, and sees their RN code rendering in the existing Onlook preview iframe with hot reload. No CSB anywhere in the request path.

### 1.1 — Extract `packages/browser-metro/`
**Source:** github.com/RapidNative/reactnative-run (MIT)

- Create `packages/browser-metro/` workspace package
- Vendor only the bundler runtime — drop Monaco, file tree, app shell, anything UI:
  - `src/worker/` — the Web Worker entry, Sucrase transform, module resolver, dependency graph
  - `src/runtime/` — React Refresh runtime that runs inside the preview iframe
  - `src/host/` — main-thread host class (postMessage to Worker, expose `bundle()` API)
- Public API (consumed only by `ExpoBrowserProvider`):
  ```ts
  export class BrowserMetro {
    constructor(opts: { esmUrl: string; vfs: Vfs; onError: (e) => void });
    setEntry(path: string): void;
    bundle(): Promise<{ moduleMap, sourceMap }>;
    onUpdate(cb: (patch) => void): () => void;  // HMR
    dispose(): void;
  }
  ```
- Add to `tsconfig.json` references and `package.json` workspaces if needed
- Strip RapidNative branding; license/attribution file preserved per MIT

### 1.2 — Wire `ExpoBrowserProvider` file ops to Supabase Storage (NOT a new VFS)
Audit Finding 3 corrected the original draft. Files live in Supabase Storage; `CodeProviderSync` mirrors to `CodeFileSystem`; browser-metro reads from `CodeFileSystem`. **No new VFS layer.**

- Create a Supabase Storage bucket `expo-projects` with RLS scoped to `auth.uid()` matching the project owner. Path scheme: `${projectId}/${branchId}/${filePath}`.
- `ExpoBrowserProvider.readFile/writeFile/listFiles/...` call Supabase Storage REST API directly. Auth uses the existing browser Supabase client at `apps/web/client/src/utils/supabase/client/index.ts`.
- `ExpoBrowserProvider.watchFiles` subscribes to a Supabase Realtime channel scoped to the branch's path prefix. Other tabs editing the same branch get realtime change events without polling.
- **No changes to `CodeFileSystem` or `CodeProviderSync`.** They're already provider-agnostic — `CodeProviderSync.start()` (`sync-engine.ts:150`) calls `provider.readFile`/`provider.watchFiles` regardless of the underlying provider type. Verify by reading `sync-engine.ts` end-to-end and confirming there are no CSB-specific assumptions.
- **OID / preload-script injection works unchanged.** `CodeFileSystem.processJsxFile` (`code-fs.ts:68`) injects OIDs and the preload script on every write to the local FS. Since CodeProviderSync is what writes to CodeFileSystem, this happens automatically when files come down from Supabase.
- **Initial population:** when a branch is first switched to ExpoBrowser, the provider needs the project's existing files to exist in Supabase Storage. Add a one-shot migration: copy from the previous provider (CSB) on first switch, idempotent. If the branch was created fresh as ExpoBrowser, populate from the GitHub template path added in commit `24eca05e`.
- **Latency target:** writeFile round-trip to Supabase under 200ms in the same region. If we see >500ms, debounce writes locally and stage in IndexedDB until the round-trip catches up — but only if measured to be a real problem.
- Manual: open Onlook on a test branch with the flag on, edit a file in Monaco, refresh the browser, verify the edit persists (proves Supabase round-trip + CodeProviderSync rehydrate cycle works).

### 1.3 — Service-worker preview server (frame URL stays a real URL)
Audit Finding 4 corrected the original draft. The canvas is multi-frame and `frame.url` is a persisted, real URL. We don't replace the iframe element — we replace **what its URL serves**.

- Register a service worker at `apps/web/client/public/preview-sw.js` scoped to `/preview/`. Registration happens in the project route's client island, gated on the active branch being ExpoBrowser.
- The service worker intercepts `fetch` events for paths matching `/preview/<branchId>/<frameId>/<route>` and serves:
  - For `/preview/<branchId>/<frameId>/` → an HTML shell that loads the bundled JS, the React Refresh runtime, the react-native-web shim, **and the existing onlook-preload-script.js** (so click-to-edit works unchanged).
  - For `/preview/<branchId>/<frameId>/bundle.js` → the latest bundle for that branch from a `BroadcastChannel`-shared in-memory cache.
  - For `/preview/<branchId>/<frameId>/_assets/...` → static assets (the preload script, runtime helpers, etc.) bundled with `apps/web/client`.
- Browser-metro Web Worker pushes new bundles to the service worker via a `BroadcastChannel('onlook-preview')`. Each push is keyed by `branchId`. The SW caches the latest bundle in memory and broadcasts an HMR patch event to any connected iframe.
- **Setting `frame.url`:** when a branch's `providerType` is `expo_browser`, the `frame.url` is set/updated to `${window.location.origin}/preview/${branchId}/${frame.id}/`. Persisted in the existing `frames` table. Multi-frame canvas works because each frame gets its own URL with its own route.
- **Iframe element is unchanged.** `view.tsx:320` keeps rendering `<WebPreviewBody src={frame.url} ...>`. Penpal connection setup at `view.tsx:285` works unchanged. The preload script is loaded by the service-worker-served HTML shell, the same way the existing CSB iframe loads it via injection.
- **Routing inside the preview:** Expo Router navigations inside the iframe become real URL changes (`pushState` etc.) that the SW intercepts. Browser back/forward works.
- **Multi-tab safety:** the BroadcastChannel is scoped to the same browser. Two tabs editing different branches get different channels (keyed by branchId). Two tabs editing the same branch share state.
- **Why a service worker and not `srcdoc`:** srcdoc breaks navigation history, breaks penpal's load lifecycle, can't host multiple frames at different routes, and breaks the preload-script injection helper. The service worker approach keeps everything that depends on a real iframe URL working.

### 1.4 — Default starter template
- Onlook already has an Expo template path (commit `1b21e438`). Confirm it produces files compatible with browser-metro (`react-native-web` resolution, no native-only deps in the entry chain)
- If incompatible, add a minimal browser-safe variant under the existing template registry

### 1.5 — Temporary ESM endpoint
- Until Sprint 2, point browser-metro at `esm.sh` (or run reactnative-esm locally via docker for dev)
- Add `NEXT_PUBLIC_BROWSER_METRO_ESM_URL` to `apps/web/client/src/env.ts`

### 1.6 — Layer C: replace runCommand stub with the narrow interceptor
- Replace the Sprint 0 `PROVIDER_NO_SHELL`-only stub in `ExpoBrowserProvider.runCommand` with the real interceptor in `packages/code-provider/src/providers/expo-browser/utils/run-command.ts` per §0.4 Layer C.
- Implementation is regex + switch over the 4 pattern groups (`install`, `uninstall`, `dev`, `build`), ~80 LOC. Each pattern's side effect is a `provider.writeFile` on `package.json` and/or a `bundler.bundle()` call.
- `runBackgroundCommand` shares the same interceptor, just doesn't await the result.
- Unit tests in `__tests__/run-command.test.ts`: one test per pattern asserting the side effect on a fake provider, plus one test asserting `PROVIDER_NO_SHELL` for unknown commands.
- Manual: open Onlook chat in a flag-on branch, ask "add react-native-paper to this project," watch the agent call `terminal_command("npm install react-native-paper")`, see `package.json` updated in Supabase, see the bundler pick it up, see the new component render.

### 1.7 — Layer A: per-tool dispatch using `getFileSystem`, plus capability-gated terminal startup
This is the bulk of the audit-driven work. The pattern in every case: each tool's `handle()` reads `provider.getCapabilities()` for the branch it's targeting and dispatches. **CSB behavior is unchanged.** No `Provider.listFilesRecursive` addition — tools read from the local `CodeFileSystem` via the existing `getFileSystem(branchId, editorEngine)` helper at `packages/ai/src/tools/shared/helpers/files.ts:5`.

#### 1.7.1 — `SessionManager.ping`
- `apps/web/client/src/components/store/editor/sandbox/session.ts:225`
- Replace `runCommand({ args: { command: 'echo "ping"' } })` with `provider.ping()`. The Provider abstract class already has `ping()` (`packages/code-provider/src/types.ts`).
- CSB's existing `ping()` (`codesandbox/index.ts:146`) currently does `commands.run('echo "ping"')` — same behavior, just routed through the provider's own method instead of the call-site reaching for `runCommand`. This means the ping no longer goes through `runCommand` for any provider, and the interceptor never has to special-case `echo`.
- ExpoBrowser's `ping()` returns `true` synchronously.

#### 1.7.2 — `SessionManager.createTerminalSessions` capability gate (replaces fake-terminal idea)
- `apps/web/client/src/components/store/editor/sandbox/session.ts:139`
- The current `createTerminalSessions` always builds **two** `CLISessionImpl` instances (task + terminal) and calls `task.initTask()` + `terminal.initTerminal()` in parallel. `initTerminal` (`terminal.ts:95`) calls `provider.createTerminal({})` unconditionally.
- **Change:** read `provider.getCapabilities().supportsTerminal` at the top of `createTerminalSessions`. For providers where it's `false` (ExpoBrowser):
  - Build only the **task** session (`CLISessionImpl` with `CLISessionType.TASK`). This calls `provider.getTask({ id: 'dev' })` which ExpoBrowser implements as a real `BrowserTask` (see below) — the task panel still works.
  - **Skip the terminal session entirely.** Don't construct the second `CLISessionImpl`. The xterm panel for shell input is hidden in the bottom UI.
- **No fake `BrowserTerminal` class is built.** The original §1.7.4 idea of a "fake terminal that displays interceptor results" is dropped — it added complexity for no real user benefit. Users on ExpoBrowser branches just don't see a terminal tab in the bottom panel; they see a task tab with the bundler logs and an inline status indicator for the dev server. The agent still has `terminal_command` for package install / dev restart (handled by the §1.6 interceptor).
- The bottom-panel UI component that renders the terminal tab (search for the consumer of `getTerminalSession('terminal')`) should also gate its render on `provider.getCapabilities().supportsTerminal` so it doesn't show an empty tab.
- **`BrowserTask` is real.** ExpoBrowser's `getTask({ id: 'dev' | 'start' })` returns a concrete `ProviderTask` implementation:
  - `open()` returns the bundler boot banner string and subscribes to bundler events
  - `run()` triggers `bundler.bundle()`
  - `restart()` re-runs `bundler.bundle()` and broadcasts a reload to the preview SW
  - `stop()` pauses bundler subscriptions
  - `onOutput(cb)` pipes bundler progress events to the xterm in the task tab
  - Lives at `packages/code-provider/src/providers/expo-browser/utils/browser-task.ts`

#### 1.7.3 — `GitManager` swap to `isomorphic-git`
- `apps/web/client/src/components/store/editor/git/git.ts`
- Add `isomorphic-git` to `apps/web/client/package.json` (~150KB minified, tree-shakable). It's the standard pure-JS git implementation.
- Create `git-backend.ts` with a `GitBackend` interface: `init()`, `status()`, `add(paths)`, `commit(msg)`, `log()`, `getCommit(sha)`, `setConfig(name, value)`, etc. — exactly the methods `GitManager` already calls.
- Two implementations:
  - `ShellGitBackend` (default, current behavior): the existing `runCommand("git ...")` calls, refactored into the interface.
  - `IsomorphicGitBackend` (new): operates over `CodeFileSystem` directly. `isomorphic-git` accepts a custom `fs` argument, so we wire it to a thin adapter over the existing `CodeFileSystem` API.
- `GitManager` constructor reads `provider.getCapabilities().supportsShell` and picks the backend. Everything above `GitManager` is unchanged (commits panel, history sidebar, commit message dialogs).
- **Remote git operations (push/pull):** `isomorphic-git` supports HTTP transport. For ExpoBrowser branches, configure it to push/pull through the user's GitHub credentials (already stored in Supabase user metadata). v1 can ship without remote ops if too complex — local git only — and document the limitation.
- Unit tests: existing GitManager tests should pass against both backends. Add new tests for `IsomorphicGitBackend` over an in-memory `CodeFileSystem`.

#### 1.7.4 — `GlobTool` reads from `CodeFileSystem`, NOT from the provider
- `packages/ai/src/tools/classes/glob.ts`
- The existing `tryGlobApproaches` chain (`bash` → `sh` → `find`) stays as-is for the CSB path.
- Add an "in-process" branch that runs **first** when `sandbox.session.provider.getCapabilities().supportsShell === false`:
  ```ts
  async function tryInProcessGlob(branchId, editorEngine, searchPath, pattern): Promise<GlobResult> {
    const fs = await getFileSystem(branchId, editorEngine);  // packages/ai/src/tools/shared/helpers/files.ts:5
    const allEntries = await fs.listAll();                   // local IndexedDB walk, no network
    const allFiles = allEntries.filter(e => e.type === 'file').map(e => e.path);
    const scoped = searchPath === '.' ? allFiles : allFiles.filter(p => p.startsWith(searchPath));
    const matched = picomatch.match(scoped, pattern, { dot: false });
    return { success: true, output: matched.join('\n'), method: 'in-process' };
  }
  ```
- **No call to `provider.*` anywhere in this path.** Latency stays local because `CodeFileSystem` is the in-browser IndexedDB mirror that the editor already populated via the existing `CodeProviderSync`.
- Add `picomatch` to `packages/ai/package.json` if not already present (it's pulled in transitively by Tailwind, so the bundle delta is zero).
- The existing path-validation steps (`test -e`, `test -d`) become `fs.stat(path)` checks via `CodeFileSystem`.
- **Drop the previously-proposed `Provider.listFilesRecursive` addition.** It was solving the wrong problem.

#### 1.7.5 — `GrepTool` reads from `CodeFileSystem`, NOT from the provider
- `packages/ai/src/tools/classes/grep.ts`
- Same dispatch as 1.7.4. When `supportsShell === false`:
  - `getFileSystem(branchId, editorEngine)` → `fs.listAll()` → filter to text files
  - For each candidate, `await fs.readFile(path)` (in-memory IndexedDB read)
  - Run the regex in JS, accumulate matches
  - Honor `--include`, `--exclude`, and `head -N` via JS-side filters
- For very large repos this is slower than ripgrep, but ExpoBrowser projects are bounded (in-browser bundling has practical file-count limits) so the worst case is acceptable.

#### 1.7.6 — `TypecheckTool` reads from `CodeFileSystem`, NOT from the provider
- `packages/ai/src/tools/classes/typecheck.ts`
- Same dispatch. When `supportsShell === false`:
  - `getFileSystem(branchId, editorEngine)` → `fs.listAll()` → filter to `.ts/.tsx`
  - Build a file map and feed into `@typescript/vfs` (Microsoft's official in-browser TypeScript package) running in a Web Worker.
- v1 fallback: if perf is unacceptable, return a graceful "typecheck unavailable in browser preview mode" instead of an error. The system prompt update in §0.7 already lists typecheck as available for browser-preview mode; if we fall back, update the prompt to drop that line.
- **Decision gate:** measure on a representative Expo project before committing. If it takes longer than 10s or uses more than 200MB, ship the fallback for v1 and add a real implementation as a Sprint 4 stretch task.

#### 1.7.7 — `BashReadTool` and `BashEditTool` per-tool capability check
- `packages/ai/src/tools/classes/bash-read.ts` and `bash-edit.ts`
- At the top of each tool's `handle()`:
  ```ts
  const sandbox = editorEngine.branches.getSandboxById(args.branchId);
  if (!sandbox?.session.provider?.getCapabilities().supportsShell) {
    return {
      success: false,
      output: '',
      error: 'PROVIDER_NO_SHELL: shell unavailable in browser-preview mode for branch ' + args.branchId,
    };
  }
  // existing shell-based path
  ```
- The tool stays in the toolset for all branches. The model sees the typed error code on the first attempted call against an ExpoBrowser branch and adapts (the system prompt language from §0.7 explicitly calls out this error code).

#### 1.7.8 — Verification across all layers
- Run the existing AI tool integration tests with `providerType=expo_browser` injected. They should all pass against the new local-FS implementations.
- Add a new integration test: in a flag-on test branch, ask the agent to "find all components that use the View import and add a className prop." Verify the agent uses `glob` + `grep` (in-process, hitting `CodeFileSystem`, not the provider), reads matching files, edits them, and the bundler picks up the changes.
- Add a multi-branch test: open a project with two branches (one CSB, one ExpoBrowser). In the same chat session, the agent calls `glob` against both branches. Verify each call routes to its own backend (shell for CSB, in-process for ExpoBrowser) based on the per-tool dispatch.

### 1.8 — In-browser screenshot capture (Position B keeps screenshots working)
**Estimate:** half a day. **Closes the screenshot gap from Position B without spinning up server-side headless browsers.**

The current screenshot pipeline uses a server-side headless browser to fetch a public CSB preview URL. For ExpoBrowser branches the preview URL is same-origin (`${window.location.origin}/preview/<branchId>/<frameId>/`), which makes in-browser DOM capture trivial — the editor and the iframe share an origin so there are no cross-origin restrictions.

- Add `html2canvas` to `apps/web/client/package.json` (~45KB gzipped, lazy-loaded — only fetched on first capture request).
- The preview SW shell (`apps/web/client/public/preview-shell.html` from §1.3) loads `html2canvas` and the existing `onlook-preload-script.js`. Extend the preload script's penpal exposure to include:
  ```ts
  // In onlook-preload-script.js (additive)
  penpalChild.expose({
    // ... existing methods (click-to-edit, navigation, etc.)
    async captureScreenshot(): Promise<string> {
      const canvas = await html2canvas(document.body, {
        useCORS: true,
        backgroundColor: null,
        scale: window.devicePixelRatio,
      });
      return canvas.toDataURL('image/png');  // base64 data URL
    }
  });
  ```
- Editor side: where the existing screenshot pipeline triggers (search for `screenshot` in `apps/web/client/src/components/store/editor/`), branch on `provider.getCapabilities().supportsRemoteScreenshot`:
  - `true` (CSB) → existing server-side headless capture path (unchanged)
  - `false` (ExpoBrowser) → call `iframe.captureScreenshot()` via the existing penpal connection at `apps/web/client/src/app/project/[id]/_components/canvas/frame/view.tsx:285`, decode the base64 data URL to a Blob, upload to the existing screenshot upload endpoint
- The upload endpoint already exists (it accepts the server-side capture's PNG today). The browser path uploads the same format to the same endpoint.
- **Limitation, documented:** ExpoBrowser screenshots only refresh while the user has the editor tab open (not from a background job). This is also true of the current CSB pipeline in practice — both trigger on session start / save / close, not from cron. If background regeneration is ever wanted, it's a separate feature for both providers.
- Manual: open an ExpoBrowser branch, edit `App.tsx`, close the tab, reopen the projects gallery, verify the project card shows the updated screenshot.

**Sprint 1 DoD:**
- Open an Expo branch with the user flag on and `branches.providerType = 'expo_browser'`.
- Edit `App.tsx` in Monaco. Change renders in the canvas iframe within 1s with React Refresh state preserved.
- The iframe `src` is a real `/preview/<branchId>/<frameId>/` URL served by the service worker.
- Click-to-edit (penpal + preload script) works.
- Multi-frame canvas (multiple frames at different routes) works.
- Two browser tabs editing the same branch see each other's changes via Supabase Realtime.
- Bottom panel: task tab shows bundler logs from `BrowserTask`; **terminal tab is hidden** (capability-gated in §1.7.2).
- Chat agent can: install a package (interceptor), find files (in-process glob, hits CodeFileSystem not provider), search content (in-process grep), commit changes (isomorphic-git), restart dev server (interceptor). `bash_read` and `bash_edit` return `PROVIDER_NO_SHELL` and the model adapts.
- Multi-branch test passes: in the same chat session, agent calls `glob` against a CSB branch and an ExpoBrowser branch. Each routes to its own backend.
- §1.8 screenshot capture: closing and reopening the project gallery shows an updated screenshot of the branch's preview, captured via in-browser `html2canvas` over the same-origin iframe.
- CSB code path is never invoked for the ExpoBrowser branch — verify by setting a console breakpoint in `CodesandboxProvider.runCommand`.
- An existing CSB branch in the same project still works exactly as before, including its server-side screenshot capture.
- Publish dropdown on the ExpoBrowser branch shows the disclaimer from §0.9, dropdown items disabled.

---

## Sprint 2 — Self-hosted package CDN (Week 2–3)

**Deliverable:** All `import` statements in user code resolve through Onlook-owned CF infrastructure. No third-party ESM dependency.

### 2.1 — `apps/cf-esm-builder` (Container + orchestrating Worker)
- Vendor the `reactnative-esm` Dockerfile (251 MB image, validated 6.7s cold start upstream)
- New Worker app at `apps/cf-esm-builder/` with `wrangler.jsonc` per the source plan §2.1
- `EsmBuilder` Durable Object class that proxies HTTP to TCP port 5200 of the Container with `sleepAfter: '2m'`
- `instance_type: 'basic'` (1/4 vCPU, 1 GiB RAM), `max_instances: 3`

### 2.2 — `apps/cf-esm-cache` (R2 caching Worker)
- New Worker at `apps/cf-esm-cache/`
- Implements the cache-first router from source plan §2.2 verbatim:
  - On request: check R2 → return with `X-Cache: HIT`
  - On miss: forward to esm-builder Container, store result in R2, return with `X-Cache: MISS`
- Bind `PACKAGES` R2 bucket and `ESM_BUILDER` Durable Object namespace
- CORS headers for cross-origin browser fetches
- Errors are not cached

### 2.3 — Pre-warm script
- `scripts/warm-esm-cache.sh` per source plan §2.3
- Onlook's top packages list (read `packages/constants/src/rn-components.ts` for the canonical RN package list)
- Add as a CI step on deploy of `cf-esm-cache`

### 2.4 — Switch browser-metro to the new CDN
- Update `NEXT_PUBLIC_BROWSER_METRO_ESM_URL` to the deployed `esm.<domain>` Worker
- Add staging vs prod URLs in `apps/web/client/src/env.ts`
- Drop `esm.sh` fallback

**Sprint 2 DoD:** `import { Button } from 'react-native-paper'` in the playground resolves through Onlook's Worker → R2 → Container pipeline. Cached packages serve in <100ms. Cold misses build and cache in <10s. Pre-warmed packages always hit cache.

---

## Sprint 3 — Expo Go device preview (Week 3–4)

**Deliverable:** A user clicks "Preview on device" in the Onlook toolbar, scans a QR with Expo Go, sees their app on a phone, and edits propagate within seconds.

### 3.1 — `apps/cf-expo-relay` (Worker + Durable Object)
- New Worker at `apps/cf-expo-relay/`
- `ExpoSession` Durable Object per source plan §3.1
- Routes:
  - `GET /session/:id/manifest` — Expo Go fetches the Expo manifest
  - `GET /session/:id/bundle.js` — Expo Go fetches the bundle from KV
  - `WS /session/:id` — browser pushes bundles
- Bind `BUNDLES` KV namespace (1hr TTL)
- **Protocol path:** decided in Sprint 0 §0.6 (Test 0.1). Result is recorded here once the spike runs:
  - **[ ] Plain HTTP path** — `serveBundle` returns the raw browser-metro output. §4.2 not needed.
  - **[ ] Metro format path** — wrap output in `__d()/__r()` per §4.2 before returning.
  - _(Sprint 0 owner: tick the right box and add a 1-paragraph note here.)_

### 3.2 — QR-code UI in the existing toolbar
- Add a "Preview on device" button to the existing project toolbar (`apps/web/client/src/app/project/[id]/_components/top-bar/`), only visible when `previewProvider === ExpoBrowser`
- On click: generate session ID, open WebSocket to `cf-expo-relay`, push current bundle, render QR with `qrcode` npm package in a modal
- Status pill: waiting / connected / error

### 3.3 — Hot reload over the relay
- Subscribe to bundle updates from `BrowserMetro` while the QR modal is open
- Push updates over the same WebSocket, debounced 300ms
- Reconnect logic on drop

### 3.4 — Console & error forwarding
- Receive `console.log/warn/error` from the device over the relay
- Display in the existing Onlook console panel (whichever component owns it today — same panel CSB writes to)
- Map error stack frames to VFS paths so click-to-source works

**Sprint 3 DoD:** Phone scans QR, app loads, edit in browser → phone updates within 3s. Device console output appears in the existing Onlook console panel.

---

## Sprint 4 — Polish & production (Week 4–5)

### 4.1 — Edge cases (port the 40 from source plan §4.1)
Plus Onlook-specific ones:
- Project switching mid-bundle (dispose Worker, drop WebSocket)
- Two browsers editing the same project (Supabase realtime convergence)
- Chat agent calls `runCommand('npm install')` → virtual install path works (per §0.4)
- User flips the flag off mid-session → graceful fallback to CSB

### 4.2 — Metro bundle format wrapper
- Only if Sprint 3 Test 0.1 showed it's needed
- Implement the `toMetroFormat` wrapper in `packages/browser-metro/src/host/metro-format.ts`

### 4.3 — Monitoring
- Workers Analytics on all three Worker apps
- Cache hit/miss logging
- Container wake-count metric
- Alerts: Container error >5%, R2 miss rate >20% post-warmup, relay WebSocket drops

### 4.4 — Docs
- `docs/expo-browser-provider.md` — what it is, when to use it, limitations vs CSB
- `docs/expo-browser-runbook.md` — deploy, monitor, troubleshoot
- Updated `CLAUDE.md` section noting the new provider exists and the agent should not assume shell access when active

**Sprint 4 DoD:** All edge cases handled, monitoring live, the team can flip a flag and trust it for an Expo project end to end.

---

## Files we'll touch (skeleton, post-audit)

```
packages/code-provider/
├── src/providers.ts                              MODIFY  add CodeProvider.ExpoBrowser
├── src/index.ts                                  MODIFY  wire registry + ProviderInstanceOptions
├── src/types.ts                                  MODIFY  add `getCapabilities()` to Provider abstract class
├── src/providers/snack/                          DELETE  remnant from unmerged branch
├── src/providers/codesandbox/index.ts            MODIFY  implement getCapabilities() returning all true
├── src/providers/cloudflare/index.ts             MODIFY  implement getCapabilities()
├── src/providers/nodefs/index.ts                 MODIFY  implement getCapabilities()
└── src/providers/expo-browser/                   NEW
    ├── index.ts                                  ExpoBrowserProvider class + getCapabilities() (all false except shell-related)
    ├── types.ts                                  ExpoBrowserProviderOptions
    ├── utils/storage.ts                          Supabase Storage REST adapter (read/write/list/watch)
    ├── utils/browser-task.ts                     Real ProviderTask for `dev` and `start` (binds bundler events to xterm)
    ├── utils/run-command.ts                      Layer C narrow interceptor (~80 LOC)
    └── __tests__/                                Unit tests for storage adapter + interceptor + browser-task

packages/browser-metro/                           NEW workspace package
├── package.json                                  Depends on @onlook/file-system (CodeFileSystem)
├── src/worker/                                   Web Worker (Sucrase + resolver)
├── src/runtime/                                  React Refresh + RN-web bootstrapping
├── src/host/                                     Main-thread host class — reads from CodeFileSystem
├── src/host/metro-format.ts                      (Sprint 4 §4.2, conditional)
└── src/host/broadcast.ts                         BroadcastChannel publisher to the preview SW

apps/cf-esm-builder/                              NEW Worker app
├── Dockerfile                                    Vendored reactnative-esm
├── src/worker.ts                                 EsmBuilder DO + Container proxy
└── wrangler.jsonc

apps/cf-esm-cache/                                NEW Worker app
├── src/worker.ts                                 R2 cache-first router
└── wrangler.jsonc

apps/cf-expo-relay/                               NEW Worker app
├── src/worker.ts                                 HTTP router
├── src/session.ts                                ExpoSession DO (WebSocket relay)
└── wrangler.jsonc

apps/web/client/
├── package.json                                  MODIFY  add isomorphic-git, @typescript/vfs, picomatch (if not transitive), html2canvas
├── src/env.ts                                    MODIFY  NEXT_PUBLIC_BROWSER_METRO_ESM_URL, NEXT_PUBLIC_EXPO_RELAY_URL
├── src/lib/feature-flags.ts                      UNCHANGED  (env-based, stays for build flags)
├── src/hooks/use-user-feature-flags.tsx          NEW    DB-backed user flag hook (§0.5)
├── src/components/store/editor/sandbox/session.ts MODIFY  ping → provider.ping(); createTerminalSessions gates on getCapabilities().supportsTerminal; read providerType from branch (§1.7.1, §1.7.2)
├── src/components/store/editor/sandbox/index.ts  MODIFY  pass provider to GitManager constructor (§1.7.3)
├── src/components/store/editor/git/git.ts        MODIFY  swap shell-runCommand for git-backend interface
├── src/components/store/editor/git/git-backend.ts NEW   GitBackend interface
├── src/components/store/editor/git/shell-git-backend.ts NEW  Existing CSB git via runCommand, refactored
├── src/components/store/editor/git/iso-git-backend.ts NEW  isomorphic-git over CodeFileSystem
├── src/app/project/[id]/_components/canvas/frame/view.tsx MODIFY  set frame.url to /preview/<branchId>/<frameId>/ for ExpoBrowser; capture screenshot via penpal (§1.8)
├── src/app/project/[id]/_components/top-bar/     MODIFY  "Preview on device" button (Sprint 3)
├── src/app/project/[id]/_components/top-bar/publish/dropdown/{provider,preview-domain-section,custom-domain/provider}.tsx MODIFY  disclaimer + disabled items for ExpoBrowser branches (§0.9)
├── src/components/ui/settings-modal/project/index.tsx MODIFY  per-branch "Preview runtime" radio (gated on runtime projectType detection per §0.5)
├── public/preview-sw.js                          NEW    Service worker — intercepts /preview/<branchId>/<frameId>/*
├── public/preview-shell.html                     NEW    HTML shell served by the SW (loads onlook-preload-script + html2canvas)
├── public/onlook-preload-script.js               MODIFY  add captureScreenshot() to penpal-exposed methods (§1.8)
└── src/components/preview/preview-sw-register.tsx NEW   Client island — registers the SW + bridges BroadcastChannel

packages/ai/
├── src/tools/classes/glob.ts                     MODIFY  add tryInProcessGlob branch using getFileSystem() (§1.7.4)
├── src/tools/classes/grep.ts                     MODIFY  add in-process branch using getFileSystem() (§1.7.5)
├── src/tools/classes/typecheck.ts                MODIFY  @typescript/vfs branch + fallback (§1.7.6)
├── src/tools/classes/bash-read.ts                MODIFY  per-tool capability check; PROVIDER_NO_SHELL when supportsShell=false (§1.7.7)
├── src/tools/classes/bash-edit.ts                MODIFY  same as bash-read
└── src/prompt/constants/system.ts                MODIFY  append branch-conditional language (§0.7) — single global string, no per-stream assembly

apps/web/client/src/server/api/routers/project/
├── project.ts                                    MODIFY  getSandboxPreviewUrl(branch.providerType, ...) at line 84 (§0.9)
├── sandbox.ts                                    MODIFY  getSandboxPreviewUrl call sites at 120,200,260; gate hibernate/shutdown on getCapabilities().supportsHibernate (§0.9)
├── branch.ts                                     MODIFY  getSandboxPreviewUrl call sites at 129,274; expose providerType in branch responses
└── fork.ts                                       MODIFY  getSandboxPreviewUrl call site at 74

apps/web/client/src/app/projects/_components/templates/
└── template-modal.tsx                            MODIFY  getSandboxPreviewUrl call site at 105 (§0.9)

apps/web/client/src/app/project/[id]/_components/bottom-bar/
└── expo-qr-button.tsx                            MODIFY  getSandboxPreviewUrl call site at 28 (§0.9)

packages/constants/
└── src/csb.ts                                    MODIFY  getSandboxPreviewUrl(provider, ...) becomes provider-aware switch (§0.9)

packages/db/
├── src/schema/project/branch.ts                  MODIFY  add providerType column (finishes existing TODO)
├── src/schema/auth/user.ts                       MODIFY  add featureFlags jsonb column
├── src/mappers/project/branch.ts                 MODIFY  expose providerType
└── src/defaults/branch.ts                        MODIFY  default providerType = code_sandbox

packages/models/
└── src/project/branch.ts                         MODIFY  Branch interface adds providerType

apps/web/client/src/server/api/routers/
├── user.ts                                       MODIFY (or NEW)  getFeatureFlags procedure
└── (chat route stays unchanged — no providerType threading needed per §0.7)

scripts/warm-esm-cache.sh                         NEW

docs/expo-browser-provider.md                     NEW
docs/expo-browser-runbook.md                      NEW
```

---

## Risk register (post-audit, Position B)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| §0.6 audit misses a `runCommand` caller, breaks silently for ExpoBrowser branches | Medium | High | The audit task is gated by a checklist in §0.6; pair with `bun test` integration runs that exercise glob/grep/typecheck/git/ping with `providerType=expo_browser` injected. Add a lint rule that flags any new direct `runCommand` caller outside the audited list |
| Per-tool dispatch on `provider.getCapabilities()` is forgotten in a tool implementation | Medium | High | Each per-tool capability check is a 4-line block at the top of `handle()`. Add a unit test per tool that asserts `PROVIDER_NO_SHELL` is returned when `supportsShell` is false. The §1.7.8 multi-branch integration test catches drift |
| The settings UI gate ("invisible until first boot") is too confusing for users | Medium | Low | The settings modal shows a one-line note: "Open this branch to see preview options." If telemetry shows users not finding the toggle, add an "Available preview runtimes" section that loads asynchronously after the branch boots |
| `isomorphic-git` over `CodeFileSystem` is slower than shell git for large repos | Medium | Medium | Benchmark on a representative branch in Sprint 1 §1.7.3. If `git status` over a 5k-file repo exceeds 2s, fall back to keeping shell git only on CSB branches. Branches with >10k files stay on CSB by recommendation |
| `isomorphic-git` lacks parity with the existing GitManager (push/pull, credentials, hooks) | High | Medium | v1 ships local git only; remote push/pull is a stretch. Document in `docs/expo-browser-provider.md`. Users on ExpoBrowser branches commit locally; pushing requires temporarily flipping the branch back to CSB (which still works because the underlying sandbox exists per Position B) |
| `@typescript/vfs` typecheck is too slow or memory-heavy for typical projects | Medium | Medium | §1.7.6 has a measurement gate. If it fails, ship a graceful "typecheck unavailable in browser preview" and update the system prompt language in §0.7 to drop typecheck from the available capabilities |
| Service worker preview cannot keep up with rapid edit cycles | Low | High | BroadcastChannel is in-memory same-origin, latency is sub-millisecond. If we see drops, add an HMR sequence number so the iframe can request a full reload on miss |
| Service worker registration conflicts with Onlook's existing service workers (PWA, etc.) | Medium | Medium | Scope the new SW to `/preview/` only. Verify no other SW claims that path. Test on Safari, Chrome, Firefox |
| `html2canvas` produces visually wrong screenshots for some RN-web components | Medium | Medium | Acceptable degradation for v1 since the screenshot is a thumbnail on the project gallery card. If a component renders incorrectly, fall back to a placeholder image and log to telemetry. Sprint 4 stretch: replace `html2canvas` with `dom-to-image-more` or a CF Browser Rendering call for the failing components |
| Same-origin screenshot capture leaks DOM state (devtools-only data, etc.) | Low | Low | The capture runs `html2canvas(document.body)` inside the iframe — only DOM nodes the user's app actually rendered. No editor state, no chat history, no other branches. Same scope as the existing CSB headless capture |
| Supabase Storage round-trip latency adds noticeable lag to every keystroke | Medium | Medium | `CodeFileSystem` is already the local-write target; Supabase persistence is async via `CodeProviderSync.pushToSandbox`. The bundler reads from `CodeFileSystem`, never from Supabase, so keystroke latency stays local-only |
| Two-tab Supabase Realtime conflicts (same branch, both editing) | Medium | Medium | Last-writer-wins via Supabase `updated_at`. Realtime delivers the loser's tab a refresh. Existing CSB tab-conflict behavior is no better |
| Onlook's preload script doesn't load through the service-worker-served HTML shell | Medium | High | The SW serves a fixed HTML shell at `public/preview-shell.html` that includes `<script src="/preview/_assets/onlook-preload-script.js">`. Verified in Sprint 1 §1.3 + §1.8 manual tests (both click-to-edit and screenshot capture flow through the same penpal channel) |
| Next.js projects accidentally get switched to ExpoBrowser (no react-native-web shim) | Low | Medium | Settings UI gates the toggle on the runtime-detected `projectType === ProjectType.EXPO` per §0.5. The settings modal only shows the toggle once the branch has booted and detected its type. No DB-level enforcement (no `projectType` column) — the UI is the only gate. Acceptable since the only way around it is direct DB edits |
| Pre-warm package list in `rn-components.ts` includes packages browser-metro can't bundle | Medium | Medium | Pre-warm script (§2.3) doubles as a smoke test. Failing packages land on a deny-list with a friendly error in Monaco |
| Position B leaves the publish UI disabled for ExpoBrowser branches in v1 | Certain | Medium | Documented limitation. Disclaimer in the publish dropdown points users back to CSB. Sprint 5+ adds an `expo export` → CF Pages publish path. Users who need publish stay on CSB or temporarily flip back |
| `branches.providerType` migration breaks existing data | Low | High | Migration sets default `'code_sandbox'` for all existing rows. Tested via `bun run db:push` on a local clone before applying. CLAUDE.md forbids `db:gen` |
| User opens a branch on a deployment where `useExpoBrowserPreview` flag is off but their DB row says `expo_browser` | Low | Medium | Provider selection logic falls back to CSB when the user flag is off, regardless of `branches.providerType`. Surfaces a clear toast: "Browser preview disabled for your account, falling back to CodeSandbox." Position B keeps this fallback cheap because the underlying CSB sandbox still exists |
| Expo SDK upgrade breaks Expo Go relay protocol | Medium | High | Pin SDK version. Source plan §risks already covers this. Snack runtime is MIT — diff their changes |

---

## Test gates carried over from upstream

The source plan has 248/250 tests passing for the upstream architecture. We re-run only the Onlook-specific ones:
- **Test 0.1** — Expo Go bundle format (run before Sprint 3 starts)
- **Test 1.x** — browser-metro extraction works in isolation
- **Onlook E2E** — flag-on Expo project: create → edit → preview → device QR → edit → device update

---

## Out of scope (explicit non-goals)
- Replacing CSB for Next.js projects
- Removing the CSB provider entirely
- Persistence in R2 (we keep Supabase as the file store)
- A standalone `apps/expo-playground/` app (we embed in the existing route)
- Custom domains for individual user previews

---

## Decisions (locked before code lands)

1. **Provider enum value name → `ExpoBrowser` / `expo_browser`.** Unchanged from the first draft.
   - `Snack` is poisoned (Expo Snack is a real hosted product this provider does not use).
   - `Expo` collides with the existing `ProjectType.Expo` constant.
   - `BrowserMetro` leaks an implementation detail.
   - `ExpoBrowser` is descriptive, distinct, and matches snake_case naming convention.

2. **Provider selection → per-branch column + DB-backed user flag.** **(Revised after audit Finding 2 + 5.)**
   - Persistent: finish the half-built `branches.providerType` migration noted at `branch.ts:30`. Default `code_sandbox`. Each branch gets its own provider.
   - Rollout: `users.featureFlags` jsonb column with `useExpoBrowserPreview: boolean`. Exposed via `useUserFeatureFlags` hook. Internal admin route flips it per email.
   - The existing env-based `feature-flags.ts` is unchanged — it stays for build-time deployment flags. The user flag is a new orthogonal mechanism.
   - When the user flag is off, provider selection always falls back to `code_sandbox` regardless of the column.
   - After GA, drop the user-flag check, keep both the column and the env-flag system.
   - Full wiring in §0.5.
   - **First draft was wrong:** proposed a per-project setting, but the actual seam is per-branch (`SessionManager.start` already takes `providerType` per branch). Per-project would have created a third source of truth on top of the half-built branch column and the sandboxId-prefix sniff.

3. **Shell handling → per-tool branch-local dispatch + narrow interceptor + capability-gated terminal startup.** **(Revised twice — first audit, then second audit.)**
   - **Per-tool dispatch (Layer A):** each tool's `handle()` reads `provider.getCapabilities()` for the branch it's targeting and dispatches. Local-FS path uses `getFileSystem(branchId, editorEngine)` from `packages/ai/src/tools/shared/helpers/files.ts:5` — **the existing helper, not a new provider method.** No `Provider.listFilesRecursive` addition.
   - **Capability-gated terminal startup:** `SessionManager.createTerminalSessions` reads `provider.getCapabilities().supportsTerminal`. For ExpoBrowser (false): create only the task session, **skip terminal session entirely**. The xterm input panel is hidden in the bottom UI. **No fake `BrowserTerminal` class is built.** A real `BrowserTask` does exist for the dev/build task.
   - **Narrow interceptor (Layer C):** `ExpoBrowserProvider.runCommand` handles only `npm install/uninstall`, `npm run dev`, `npm run build` patterns. Everything else returns `PROVIDER_NO_SHELL`.
   - **System prompt:** single global string with appended branch-conditional language. **No threading of `providerType` through `createRootAgentStream`.** Tools surface `PROVIDER_NO_SHELL` errors at call time and the model adapts.
   - **First draft was wrong:** proposed Layer C as the whole solution. **First audit's revision was also wrong:** proposed stream-level toolset scoping, which fails because the chat stream is project-scoped and a project can have mixed-provider branches in the same stream. The current shape lives entirely at the per-tool / per-call level, which is the only place where `branchId` is available.
   - Full call-site table and dispatch contracts in §0.4 and §1.7.

4. **File backing store → Supabase Storage; CodeFileSystem stays the local mirror.** **(Revised after first audit Finding 3.)**
   - The provider IS the source of truth (same model as CSB). For ExpoBrowser, "the provider" is Supabase Storage REST keyed by `projectId/branchId/path`.
   - The existing `CodeFileSystem` (`code-fs.ts:32`) and `CodeProviderSync` (`sync-engine.ts:150`) layers are unchanged. They already mirror provider files into IndexedDB and push edits back. ExpoBrowser plugs into the same seam.
   - browser-metro reads from `CodeFileSystem`, never from Supabase directly. Keystroke latency stays local.
   - Search tools (glob, grep, typecheck) also read from `CodeFileSystem` via `getFileSystem(branchId, editorEngine)` — **never** from the provider. This was a second-audit correction.
   - **First draft was wrong:** proposed an "in-memory VFS that mirrors Supabase," which was just `CodeFileSystem` under a different name plus a parallel sync loop.

5. **Preview iframe → service worker at `/preview/*`, NOT srcdoc/eval.** **(Revised after first audit Finding 4.)**
   - Each `frame.url` becomes a real same-origin URL: `${origin}/preview/<branchId>/<frameId>/<route>`.
   - A new service worker (`public/preview-sw.js`) intercepts those paths and serves an HTML shell + bundled JS from a `BroadcastChannel`-shared store.
   - The iframe element itself (`view.tsx:320`) is **unchanged**. Penpal connection setup, multi-frame canvas, navigation history, and the existing onlook-preload-script all keep working.
   - **First draft was wrong:** proposed a `BrowserMetroPreview` component using srcdoc/eval. The audit found the canvas is multi-frame, `frame.url` is persisted state, and penpal needs a real iframe load lifecycle.
   - Full design in §1.3.

6. **System prompt → append global branch-conditional language; no per-stream threading.** **(Revised after second audit.)**
   - The chat-stream request body (`apps/web/client/src/app/api/chat/route.ts:56`) only carries `projectId`, not `branchId`. A single stream can target multiple branches with different providers.
   - The system prompt at `packages/ai/src/prompt/constants/system.ts:1` gets a single appended block (~7 lines) that explains: "some branches run in browser-preview mode; tools may return `PROVIDER_NO_SHELL`; use file ops + in-process search + the package-management commands instead." Unconditional, applies to every chat stream.
   - Per-tool `handle()` methods do the actual capability check at call time using `branchId`.
   - **First audit's proposal was wrong:** wanted to thread `providerType` through `createRootAgentStream` and assemble the prompt dynamically per stream. That doesn't work because there's no single authoritative provider for a stream.
   - Lands in §0.7. Half a day of work, no `createRootAgentStream` changes.

7. **`branch.projectType` is detected at runtime, NOT a new column.** **(New, addresses second audit Finding 2.)**
   - `Branch` model has no `projectType` field today. Project type is detected at runtime via `SandboxManager.getProjectType()` (`apps/web/client/src/components/store/editor/sandbox/index.ts:85`) by inspecting provider files.
   - The settings UI gates the "Preview runtime" toggle on the runtime-detected `projectType === ProjectType.EXPO`, not on a DB column.
   - Acceptable consequence: the toggle is invisible until the user has opened the branch once (the in-memory MobX state has to be populated). Documented in the modal: "Open a branch to see its preview options."
   - **First-audit revision was wrong:** wanted to add a `projectType` column. Unnecessary — the runtime detection already exists and is used everywhere else in the editor.

8. **Position B: drop CSB everywhere it's a hard-coded reference, except publish.** **(New, after the "why do we still need CSB" question.)**
   - 7 hard-coded `getSandboxPreviewUrl('code_sandbox', ...)` call sites are refactored to take `branch.providerType`. ~1 hour of changes.
   - `hibernate`/`shutdown` server flows are gated on `provider.getCapabilities().supportsHibernate`. ~30 min.
   - The publish dropdown is the only feature disabled in v1. ExpoBrowser branches see a disclaimer pointing them back to CSB if they need to publish.
   - Branches still retain their original CSB `sandboxId` (the column stays populated) so users can flip back to CSB at any time. Pure ExpoBrowser-only branches with no CSB sandbox are out of scope until Sprint 5+, after every `sandboxId` consumer is migrated.
   - **Why not fully drop CSB:** screenshot capture and the publish flow are the only things in the codebase that fundamentally need *something* to render/host the app outside the editor browser tab. Position B handles screenshot via #9 below; publish is deferred.
   - **Why not keep CSB as a placeholder for everything:** that's "Position A" — it leaves the codebase in a half-state where every `sandboxId` consumer says "this works with CSB, ExpoBrowser tolerates it." Position B forces those consumers to be provider-aware on Day 1.
   - Full migration checklist in §0.9.

9. **Screenshots stay enabled via in-browser `html2canvas` over the same-origin iframe.** **(New, after the "why can't we do screenshots in Position B" question.)**
   - The new preview URL is `${origin}/preview/<branchId>/<frameId>/` — same origin as the editor. `html2canvas` (~45KB gzipped) can capture the iframe DOM directly.
   - The existing penpal channel is extended with a `captureScreenshot()` method exposed by the preload script. The editor calls it when capture is needed and uploads the resulting PNG to the existing screenshot upload endpoint.
   - **No server-side headless browser** for ExpoBrowser branches. CSB branches keep using the existing server-side path.
   - Limitation: screenshots only refresh while the user has the editor tab open. The current CSB pipeline has the same property in practice (capture is triggered on session open/close, not from a background job). Background regeneration would be a separate feature for both providers.
   - Full design in §1.8.

10. **Test 0.1 (Expo Go bundle format) → run in Sprint 0, owned by the CF Worker engineer.** Unchanged from the first draft.
    - Spike is ~2 hours. iOS Simulator or Android Emulator works — no physical device needed.
    - Result determines whether `cf-expo-relay` ships the simple HTTP path or the Metro `__d()/__r()` wrapper.
    - Full procedure in §0.8. Result recorded in §3.1.
