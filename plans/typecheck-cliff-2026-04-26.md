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

Cleaner sub-option: extract the `allToolset` definition out of `@onlook/ai/tools/toolset.ts` into a leaf package (`@onlook/chat-tools` or similar) that doesn't pull in `@onlook/ui`. Models depends on the leaf package. AI depends on the leaf package. Cycle broken.

**Effort:** 1–2 days. Low risk if leaf-package extraction is clean.

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

**Option A's leaf-package extraction** is the smallest scope with clearest payoff. Suggested PR shape:

1. Create `packages/chat-tools/` with the toolset definition pulled out of `packages/ai/src/tools/toolset.ts`.
2. `packages/ai/src/tools/toolset.ts` re-exports from the new package (no behavior change).
3. `packages/models/src/chat/message/message.ts` imports `ChatTools` from `@onlook/chat-tools` instead of `@onlook/ai`.
4. Verify: `bun --filter '*' typecheck` shows the 14 packages now passing (target: 33/33 instead of 19/33).
5. Extend the root `typecheck` filter in `package.json` to include all 33 packages.

Bonus follow-up — file the same set of packages into the root `test` script (a separate audit-pattern catch from `b5ce0934` + `27370df7`).
