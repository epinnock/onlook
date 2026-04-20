# Workers-Only Two-Tier Bundle Pipeline - Parallel Task Queue

**Status:** Wave 0 foundation in progress on `feat/two-tier-bundle`.
**Integration branch:** `feat/two-tier-bundle`
**Worktree root:** `.trees/two-tier-bundle`

This queue tracks the workers-only two-tier bundle pipeline:

- Tier 1: a static React Native base bundle built offline by `@onlook/base-bundle-builder`.
- Tier 2: a browser-built user overlay emitted by `@onlook/browser-bundler`.
- Delivery: existing Cloudflare Worker, Durable Object, KV, and R2 primitives.
- Explicit non-goal: no CF Containers or external Node origin in the hot path.

## Worktree Policy

Each task runs in an isolated worktree:

```bash
git worktree add -b ai/<task-id>-<slug> .trees/<task-id>-<slug> feat/two-tier-bundle
```

Each task worktree has a `TASK.md` with:

- `Task ID`
- `Allowed files`
- `E2E gate`
- `PREVIEW_SLOT`

Agents must not edit outside the allowed files. Merge only into `feat/two-tier-bundle`.

## Wave 0 Status

Completed on `feat/two-tier-bundle`:

- `Q0-02` env flag
- `Q0-03` pipeline flag helper
- `Q0-04` base-bundle-builder package manifest
- `Q0-05` base-bundle-builder tsconfig/index
- `Q0-06` browser-bundler package manifest
- `Q0-07` browser-bundler tsconfig/index
- `Q0-08` hello fixture
- `Q0-09` tabs-template fixture
- `Q0-11` mobile-preview route contracts
- `Q0-12` manifest/status helpers
- `Q0-13` bundle-store/relay helpers
- `Q0-14` mobile-preview server rewire
- `Q0-15` editor pipeline contracts
- `Q0-16` shim pipeline wrapper
- `Q0-17` two-tier placeholder
- `Q0-18` service pipeline selector
- `Q0-22` R2 binding stub
- `Q0-23` Worker base-bundle route stubs

Remaining Wave 0 leaves:

- `Q0-10` fixture registry test
- `Q0-19` E2E fixture-project helper
- `Q0-20` base-bundle harness helper
- `Q0-21` baseline smoke spec

## Validation Notes

Focused validations are run per task. The full `bun run typecheck` currently fails on existing baseline errors outside this queue. `bun install --frozen-lockfile` also fails after adding new workspace packages because `bun.lock` needs workspace metadata, but lockfile edits are intentionally deferred to the maintainer per repo instructions.

