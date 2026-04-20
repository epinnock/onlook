# Workers-Only Two-Tier Bundle Pipeline - Parallel Task Queue

**Status:** Wave 0 complete; Waves A/B/C core helpers in progress on `feat/two-tier-bundle`.
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
- `Q0-10` fixture registry test
- `Q0-11` mobile-preview route contracts
- `Q0-12` manifest/status helpers
- `Q0-13` bundle-store/relay helpers
- `Q0-14` mobile-preview server rewire
- `Q0-15` editor pipeline contracts
- `Q0-16` shim pipeline wrapper
- `Q0-17` two-tier placeholder
- `Q0-18` service pipeline selector
- `Q0-19` E2E fixture-project helper
- `Q0-20` base-bundle harness helper
- `Q0-21` baseline smoke spec
- `Q0-22` R2 binding stub
- `Q0-23` Worker base-bundle route stubs

Remaining Wave 0 leaves: none.

## Wave A/B/C Progress

Additional completed leaves merged on `feat/two-tier-bundle`:

- `QA-01` base-bundle options contract
- `QA-02` Metro config factory
- `QA-03` curated React/RN dependency list
- `QA-04` Expo dependency extension
- `QA-05` synthetic base-bundle entry generator
- `QA-06` adapter alias-map runtime
- `QA-07` adapter overlay evaluator
- `QA-08` alias-emitter skeleton
- `QA-09` alias-emitter graph read helpers
- `QA-10` build option normalization
- `QA-11` injected Metro build wrapper
- `QA-12` artifact hash metadata
- `QA-13` artifact validation
- `QA-14` alias completeness validation
- `QA-15` CLI parser
- `QA-16` CLI package script/bin wiring
- `QA-17` R2 client config helper
- `QA-18` immutable R2 upload helper
- `QA-19` asset manifest extraction
- `QA-20` asset upload wiring
- `QB-01` esbuild-wasm path resolver
- `QB-02` esbuild singleton loader
- `QB-03` virtual FS resolve plugin
- `QB-04` virtual FS load plugin
- `QB-05` external bare-import plugin
- `QB-06` small asset inline plugin
- `QB-07` large asset R2 rewrite plugin
- `QB-08` browser bundle options
- `QB-09` browser bundle entry
- `QB-10` overlay wrapper
- `QB-11` project-root detector
- `QB-12` worker protocol
- `QB-13` worker runtime
- `QB-14` worker client
- `QB-15` error normalizer
- `QB-16` sourcemap helpers
- `QB-17` unsupported-import preflight
- `QC-01` relay env binding types
- `QC-02` HmrSession DO shell
- `QC-03` two-tier manifest route contract
- `QC-04` asset route module
- `QC-05` base-bundle route module
- `QC-06` overlay protocol message
- `QC-07` DO overlay fan-out
- `QC-08` last-overlay replay
- `QC-10` base-version KV reader
- `QC-11` base-version KV writer

Known remaining implementation gates:

- `QC-09`, `QC-12`, and `QC-13` still need to wire the new relay modules into HTTP dispatch.
- Browser bundler still needs `QB-18` incremental rebuild and browser-bundler E2E specs.
- Waves D/E/G/F remain downstream; simulator, physical-device, and 7-day dogfood gates cannot be completed in this automation pass.

## Validation Notes

Focused validations are run per task. The full `bun run typecheck` currently fails on existing baseline errors outside this queue. `bun install --frozen-lockfile` also fails after adding new workspace packages because `bun.lock` needs workspace metadata, but lockfile edits are intentionally deferred to the maintainer per repo instructions.
