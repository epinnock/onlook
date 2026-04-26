# Typecheck cliff — 14 packages blocked on a single cross-package type leak

**Status:** documented gap, awaiting coordinated fix
**Date:** 2026-04-26
**Discovered:** session post-compaction audit, commits `b8b35674` + `cb95788e`

## Summary

CI's typecheck job covers 19 of 33 workspaces today (root-filter `bun typecheck` in `package.json`). The remaining 14 packages all fail with the same type-resolution chain reaching into `apps/web/client/src/components/store/editor/...` files that use web-client-only path aliases (`@/trpc/client`, `@/env`, `@onlook/ui/sonner`, etc.) — aliases which are declared in `apps/web/client/tsconfig.json` but invisible to a per-package tsc invocation.

Without this fix, future regressions in any of these 14 packages (or anything they import transitively from `@onlook/models` / `@onlook/ai`) won't be caught in CI.

## The leak chain

```
package X tsconfig.json
  include: src/**/*
  ↓
src/foo.ts: import type { Y } from '@onlook/models'
  ↓
packages/models/src/index.ts → re-exports './chat'
  ↓
packages/models/src/chat/message/message.ts:1
  import type { ChatTools } from '@onlook/ai';   ← THE LEAK ROOT
  ↓
packages/ai/src/index.ts → re-exports './contexts'
  ↓
packages/ai/src/contexts/classes/agent-rule.ts:2
  import { Icons } from '@onlook/ui/icons';   ← .tsx file, JSX needed
  (cb95788e fixed JSX-side via base.json `jsx: preserve`)
  ↓
packages/ui/src/components/icons/index.tsx:N
  imports / re-exports ... eventually reaches
  ↓
apps/web/client/src/components/store/editor/api/index.ts:1
  import { api } from "@/trpc/client";   ← TS2307 (path-alias unresolvable here)
  import type { ChatMessage } from "@onlook/models";   ← back into the chain
```

## The 14 affected packages

`@onlook/ai`, `@onlook/code-provider`, `@onlook/constants`, `@onlook/db`, `@onlook/email`, `@onlook/file-system`, `@onlook/fonts`, `@onlook/growth`, `@onlook/models`, `@onlook/parser`, `@onlook/penpal`, `@onlook/ui`, `@onlook/utility`, `@onlook/web-preload`.

Each typechecks `bunx tsc --noEmit` standalone but fails when the dependency chain pulls them into the broken graph.

## Fix options

### Option A — Refactor `@onlook/models` to not depend on `@onlook/ai`

The single offending import is `models/src/chat/message/message.ts:1`:
```ts
import type { ChatTools } from '@onlook/ai';
```

Used to type two `UIMessagePart<...>` / `UIMessage<...>` parameters. ChatTools = `InferUITools<typeof allToolset>` (in `ai/tools/toolset.ts`).

Naive replacement with `UITools` from `'ai'` package compiles but loses tool-name narrowing across **57 consumers** in the editor (most do `part.type === 'tool-getProjectFiles'`-style discrimination on the union). Would require consumer-side adjustments in those 57 sites.

**Cleaner sub-option (deeper than initially thought):** extract the `allToolset` definition. Investigation 2026-04-26 found this isn't a clean leaf — every tool class in `packages/ai/src/tools/classes/*.ts` has TWO inbound coupling problems:

1. `import { Icons } from '@onlook/ui/icons'` — static class property `static readonly icon = Icons.X` for chat-UI rendering. Couples tool definition (data + handler) to UI rendering.

2. `import type { EditorEngine } from '@onlook/web-client/src/components/store/editor/engine'` — direct deep import from `apps/web/client/src/...`. This is the actual SOURCE of the `@/trpc/client` cliff: when models → ai → tools/classes/* → @onlook/web-client/src/components/store/editor/engine, tsc tries to compile the editor source files which use web-client-only path aliases.

Fixing properly requires:
- Moving `Icons` references out of tool classes into a separate UI-concern adapter (or passing them as injected deps).
- Either (a) extracting `EditorEngine` out of `apps/web/client/src/` into a package, or (b) typing tool handlers with a structural `EditorEngine`-like interface that doesn't require importing the concrete class.

**Effort:** 3–4 days. Multiple files in `packages/ai/src/tools/classes/` (~20 tool classes) plus consumer-side adjustments.

### Option B — TypeScript project references

Set `composite: true` on every workspace package's tsconfig. tsc treats each package as an opaque boundary — type-checks consume each package's emitted `.d.ts` rather than walking source. Path-alias issues in `apps/web/client/src/...` no longer leak into per-package tsc runs.

**Effort:** 2–3 days (every tsconfig.json changes; build orchestration may need updates).

### Option C — Move shared types out of `apps/web/client/src/`

The actual leaf of the chain is several files in `apps/web/client/src/components/store/editor/...` that:
- Use `@/trpc/client` etc. (web-client-only aliases)
- Are referenced by transitive type chains starting from `@onlook/models`

Extract just the type-shapes those packages need into a new package (`@onlook/editor-types` or similar). Replace the imports in models/ai with this new package. apps/web/client/src/ becomes a private leaf of the dependency graph (no package depends on it).

**Effort:** 2–3 days. Low risk because it only touches type definitions.

## Why we shipped half a fix in `cb95788e`

Adding `"jsx": "preserve"` to `tooling/typescript/base.json` removed the JSX-parse half of the failures (TS6142 errors when tsc reaches `.tsx` files in `@onlook/ui`). Path-alias TS2307 errors remain. Currently-passing 19 packages stayed green (the JSX setting is dormant for non-JSX packages).

Net: error count per failing package roughly halved; the remaining errors are exclusively the architectural debt above, with no JSX noise.

## Recommended next step

**Option C** (extract shared types out of `apps/web/client/src/`) is now the recommended path after the deeper investigation, because Option A's effort scales with the number of tool classes (~20) and Option B is even bigger.

Suggested PR shape for Option C:

1. Identify the leaf types pulled in by the chain. The crucial ones are `EditorEngine` (the class) and a few related types in `apps/web/client/src/components/store/editor/`.
2. Create `packages/editor-engine-types/` (or similar) with a structural interface `EditorEngineLike` that mirrors the surface tool classes consume (`api.webSearch`, `api.applyDiff`, etc.).
3. Update `packages/ai/src/tools/classes/*.ts` to import `EditorEngineLike` from the new package instead of the concrete `EditorEngine` from web-client.
4. The concrete `apps/web/client/src/.../engine.ts:EditorEngine` class implements `EditorEngineLike` (structural conformance, no explicit `implements` needed in TypeScript).
5. Verify: `bun --filter '*' typecheck` should drop the 14 failures to 0 (target: 33/33 instead of 19/33).
6. Extend root `typecheck` filter + `test` filter to include the newly-clean packages.

**Why Option C over Option A:** Option C only touches the tool-class import lines (~20 simple `import type` rewrites). Option A requires removing the `Icons` static class property from each tool class AND finding an alternate home for the static-icon mapping that the chat UI consumes — that's two coordination axes vs one.

Bonus follow-up — file the same set of packages into the root `test` script (a separate audit-pattern catch from `b5ce0934` + `27370df7` + `711a5124`).
