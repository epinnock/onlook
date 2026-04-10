# Expo browser Phase X — corrective task queue

> **⛔ STATUS: BLOCKED — DO NOT DISPATCH (2026-04-08)**
>
> The TX0.1 spike returned **RESULT: FAIL**. The premise of Phase X — that
> `react-native` can be pre-built as an ESM library and consumed from
> cf-esm-cache by Expo Go — is architecturally unsound. RN is not a library;
> it's the JS half of a JS↔native bridge that initializes itself on first
> import and assumes a single instance per JS context. Two copies cannot
> coexist with Expo Go's already-loaded RN runtime.
>
> **See `plans/expo-browser-x-spike-result.md` for the full analysis.**
>
> The Phase H Container architecture (PR #9) is in fact correct. Optimization
> work on Phase H is tracked in `plans/expo-browser-h-optimization.md`
> (to be created). This file is kept as a historical record of the
> corrective attempt that the spike disproved — do NOT delete it, but do
> NOT dispatch any of the tasks below.

**Source plans (canonical context):**
- `plans/expo-browser-implementation.md` — original implementation plan
- `plans/expo-browser-task-queue.md` — parent queue (Waves 0–J landed)
- `plans/expo-browser-e2e-task-queue.md` — Phase R/H/Q queue (PR #9, 63 commits, 13/14 scenarios passing)
- `plans/expo-browser-status.md` — running status doc

**Why this queue exists (the architectural correction):**

Phase H in `expo-browser-e2e-task-queue.md` was built on a wrong premise. The cf-esm-builder Container was originally designed (parent queue Wave F) for **bundling npm libraries into ESM artifacts** stored in cf-esm-cache. I reread the queue prompt as "Container runs Metro+Hermes per project per build" and built a per-project bundling pipeline (`build.sh` → `extract-source.sh` → `run-metro.sh` → `run-hermes.sh`). That works (verified at the docker-run layer in scenarios 08/09/12) but it's **the wrong job for the Container**:

1. Per-project bundling per click is wasteful — Cloudflare Container compute, ~25–90s wait, no live edits
2. The user's project bundling is what `@onlook/browser-metro` is designed for — runs in the user's tab, sub-second, no server
3. Real RN ESM bundles need to come from somewhere — esm.sh's `react-native?bundle` returns 500. Building them ourselves (one time per package version) is exactly what the Container should do
4. The phone Expo Go path needs a JS bundle uploaded to a public URL with an Expo manifest — which is what cf-expo-relay should serve via a `POST /publish` endpoint, not the editor → builder → R2 → cache → relay round-trip the current PR implements

**Phase X re-aligns the architecture so:**
- The Container exists only to **build npm libraries into ESM bundles** (one-time per package version, batch-driven, ~10 builds total across all of Onlook's users for the standard library set)
- `@onlook/browser-metro` does **all per-project bundling** in the user's browser, with a new `target: 'native'` mode that resolves bare imports against cf-esm-cache (the Container's library outputs) instead of esm.sh
- `cf-expo-relay` gains a `POST /publish` endpoint that accepts the bundle from the editor and serves it via an Expo manifest URL, eliminating the per-preview Container round-trip
- The editor's `usePreviewOnDevice` hook flips from "POST source-tar to builder + poll" to "BrowserMetro.bundle({target: 'native'}) → POST bundle to relay → render manifest URL"

**Result:** zero Container invocations per preview. Live editing on the phone via repeat `BrowserMetro.bundle()` calls in the editor (~200ms each). Container is invoked once per library version, ever, globally across all users.

**This queue is the work to implement the correction.** It does NOT delete the existing PR — most of the infrastructure stays useful (Container Dockerfile, BuildSession DO, R2 binding, cf-esm-cache, cf-expo-relay manifest builder, browser-metro core, Phase R canvas iframe). The queue specifies which files to repurpose, which to scrap, which to add, and the test gates that prove the new flow works end to end.

---

## Conventions (delta from parent queue)

Inherit everything from `plans/expo-browser-task-queue.md` "Conventions" and `plans/expo-browser-e2e-task-queue.md` "Conventions (delta from parent)". Phase X-specific deltas:

### Base branch

All worktrees branch from `feat/expo-browser-provider` at the current head (commit `4fb93cfe` or later). Pattern:

```bash
git worktree add -b ai/<task-id>-<slug> .trees/<task-id>-<slug> feat/expo-browser-provider
```

After validation passes, merge back to `feat/expo-browser-provider`. The integration branch stays the long-running staging branch.

### Validation gate — same Chrome MCP model + new layer

Phase X adds two validation layers on top of the existing Chrome MCP scenario walks:

1. **Per-task unit tests** (`bun test <package>` exits 0)
2. **Per-task scenario walk** via Chrome MCP for the scenarios that exercise the new code path
3. **NEW: Architectural integrity check** — every Phase X task includes an explicit assertion that it does NOT regress an existing scenario in `apps/web/client/verification/onlook-editor/results.json`. A task that passes its own gates but breaks scenario 06 (Phase R canvas iframe) is dead-lettered.

The orchestrator's automated validate is now three checks:
```bash
cd .trees/<task-id>-<slug>
bun run typecheck && bun test <task-specific-unit-tests>
jq -e '.scenarios | with_entries(select(.value.state == "passed")) | length >= 13' \
   apps/web/client/verification/onlook-editor/results.json
# Plus the new scenario gate when applicable:
jq -e '.scenarios["<NN>"].state == "passed"' apps/web/client/verification/onlook-editor/results.json
```

### Dependency on the Phase X spike

Phase X starts with a **mandatory spike** (TX0.1 below) that proves the most uncertain assumption: **can our Container actually produce a `react-native` ESM bundle that runs in Expo Go on a real phone?** If the spike fails, the queue stops and we pivot — no point implementing the rest of Phase X if the foundation doesn't hold.

**TX0.1's pass criterion (esbuild-based, NOT Metro):**
1. `esbuild $(node -p "require.resolve('react-native')") --bundle --format=esm --platform=neutral --target=es2022 --external:react --external:react-dom --outfile=/tmp/spike-rn-esm/index.mjs` produces a single ESM file in <5s
2. The ESM file exports `View`, `Text`, `StyleSheet`, `AppRegistry`, `Platform` (at minimum) as named exports — verified via `node --input-type=module -e "import('/tmp/spike-rn-esm/index.mjs').then(m => console.log(Object.keys(m)))"`
3. A hand-crafted minimal bundle that imports from this ESM file (via a file:// or local HTTP URL) loads in Expo Go on a real phone and renders text

**Why esbuild, not Metro:** Metro is an app bundler (designed to produce platform-specific JSC/Hermes payloads with the RN runtime baked in). esbuild has first-class CJS-to-ESM conversion and can produce a neutral ESM artifact in ~1-2s for `react-native`, vs ~30-60s for Metro library mode (which doesn't really exist anyway). esbuild also keeps the Container image to ~150MB (vs 651MB with Metro+Hermes baked in).

If 1 + 2 work but 3 fails, we have a smaller pivot (different runtime shim strategy — most likely needing a small RN globals shim injected at the consumer side). If 1 fails, the whole Phase X is moot.

### Files getting REMOVED in Phase X (track these so reverts are clean)

| File | Why |
|---|---|
| `apps/cf-esm-builder/container/build.sh` | Per-project bundling — wrong job for Container |
| `apps/cf-esm-builder/container/lib/extract-source.sh` | No source-tar input anymore |
| `apps/cf-esm-builder/container/lib/run-metro.sh` | Project Metro is browser-metro's job |
| `apps/cf-esm-builder/container/lib/run-hermes.sh` | Libraries don't need Hermes bytecode (browser-metro consumers run JSC/Hermes interpreter) |
| `apps/web/client/src/services/expo-builder/source-tar.ts` | No source-tar push to builder |
| `apps/web/client/src/services/expo-builder/build-orchestrator.ts` | Replaced by direct browser-metro bundle + relay POST |
| `apps/cf-esm-builder/src/routes/build.ts` (current shape) | POST /build refactors from "tar" to "library name" |
| `apps/cf-esm-builder/container/__tests__/fixtures/minimal-expo/` | Project fixture irrelevant; Container only takes package names now |
| `scripts/seed-expo-fixture.ts` | Phase R-only artifact; Phase X uses browser-metro which reads from CodeFileSystem directly |

These deletions happen in **TX1.0** (sequential) before any Wave X1+ tasks start. The deletions are tracked in a single commit to make Phase X reversible by `git revert`.

### Files getting REPURPOSED (kept, modified)

| File | Old role | New role |
|---|---|---|
| `apps/cf-esm-builder/Dockerfile` | Multi-stage Node + Expo + Hermes | Multi-stage Node + esbuild + npm. Drop Expo CLI, Hermes binary, AND Metro (not needed for library bundling). Result: ~150 MB image (vs 651 MB). |
| `apps/cf-esm-builder/src/do/build-session.ts` | DO that owns one Container build per source-tar | DO that owns one Container build per `(packageName, version)` tuple |
| `apps/cf-esm-builder/src/lib/r2.ts` | R2 helpers for `bundle/<sha256>/` keys | R2 helpers for `library/<pkg>/<version>/index.mjs` keys |
| `apps/cf-esm-builder/src/lib/hash.ts` | sha256OfTar | sha256OfBytes (smaller surface) |
| `apps/cf-esm-cache/src/worker.ts` | SWR proxy on `/bundle/<hash>` | SWR proxy on `/library/<pkg>/<version>/...` |
| `apps/cf-expo-relay/src/manifest-builder.ts` | Builds Expo manifest from cf-esm-builder R2 | Builds Expo manifest from cf-expo-relay R2 (post-publish bundle) |
| `apps/cf-expo-relay/src/routes/manifest.ts` | GET /manifest/:bundleHash reads from cf-esm-cache | Same shape, different R2 prefix |
| `packages/browser-metro/src/host/bare-import-rewriter.ts` | Web-target rewriter (alias react-native → react-native-web esm.sh URL) | Add `target: 'web' \| 'native'` mode. Native skips alias, points at cf-esm-cache library URL. |
| `packages/browser-metro/src/host/index.ts` | `bundle()` produces web bundle | `bundle({target})` produces web OR native bundle |
| `apps/web/client/src/hooks/use-preview-on-device.tsx` | tar source → POST builder → poll → manifest URL | BrowserMetro.bundle({target:'native'}) → POST relay/publish → manifest URL |

### Files NEW in Phase X

| File | Purpose |
|---|---|
| `apps/cf-esm-builder/container/build-library.sh` | Container entrypoint — takes `{name, version}` JSON on stdin, npm-installs the package, runs esbuild against its main entry, emits ESM to `/output/index.mjs` + meta.json |
| `apps/cf-esm-builder/container/lib/build-library-esbuild.sh` | esbuild driver — wraps esbuild invocation, handles externals, captures metafile |
| `apps/cf-esm-builder/container/lib/esbuild-library.config.mjs` | esbuild JS config (executed via `esbuild --config` equivalent) — sets `format: 'esm'`, `platform: 'neutral'`, `target: 'es2022'`, externalizes `react`/`react-dom` |
| `apps/cf-esm-builder/container/__tests__/fixtures/library-targets.json` | List of standard packages to pre-build |
| `apps/cf-esm-builder/src/routes/build-library.ts` | POST /build-library route |
| `apps/cf-expo-relay/src/routes/publish.ts` | POST /publish route — receives JS bundle, hashes, stores |
| `apps/cf-expo-relay/src/lib/r2.ts` | R2 helpers for `published/<hash>/bundle.js` |
| `apps/web/client/src/services/expo-relay/publish-client.ts` | HTTP client for POST /publish |
| `scripts/prewarm-libraries.sh` | Pre-warm script — POSTs the standard library set to deployed builder |
| `apps/cf-esm-builder/.dev.vars.example` | Updated for the new env shape |

---

## Phase X — corrective architecture

```
                    Wave X0 (SEQUENTIAL, 1 agent)
                    ─────────────────────────────
                    TX0.1  Spike: build react-native as ESM, verify in Expo Go
                    TX0.2  Lock the Phase X contracts (interfaces, R2 layout, protocol)
                    TX0.3  Document the architectural correction in status.md
                    TX0.4  Update results.json schema for new scenarios 15-22
                                                │
                                                │ (Wave X0 must merge before X1)
                                                ▼
                      ┌─────────────────────────┼─────────────────────────┐
                      ▼                         ▼                         ▼
        Wave X1 (Container)        Wave X2 (Worker)        Wave X3 (browser-metro)
        PARALLEL up to 5            PARALLEL up to 6        PARALLEL up to 5
        TX1.0 deletions (sequential)
        TX1.1 build-library.sh      TX2.0 deletions (seq)   TX3.1 rewriter target mode
        TX1.2 metro.config.library  TX2.1 build-library.ts  TX3.2 host types target
        TX1.3 library entry gen     TX2.2 BuildSession DO   TX3.3 host bundle({target})
        TX1.4 Dockerfile slim       TX2.3 lib/r2.ts refactor TX3.4 native rewriter tests
        TX1.5 smoke against         TX2.4 lib/hash.ts       TX3.5 host integration
              react-native@0.81.0   TX2.5 worker.ts router    test (3-file native)
        TX1.6 library-targets.json  TX2.6 prewarm script
                                                │
                      ┌─────────────────────────┼─────────────────────────┐
                      ▼                         ▼                         ▼
        Wave X4 (cf-esm-cache)     Wave X5 (relay)         Wave X6 (editor)
        PARALLEL up to 3            PARALLEL up to 4        SEMI-SERIAL up to 4
        TX4.1 worker.ts /library/   TX5.1 publish.ts route  TX6.1 publish-client.ts
        TX4.2 invalidate /library/  TX5.2 lib/r2.ts publish TX6.2 hook refactor
        TX4.3 wrangler.jsonc        TX5.3 manifest.ts swap  TX6.3 button env wiring
                                    TX5.4 wrangler.jsonc    TX6.4 services/expo-builder
                                                              cleanup (orphan files)
                                                │
                                                ▼
                                Wave X7 — Verification (PARALLEL up to 8)
                                ─────────────────────────────────────────
                                TX7.15 scenario 15: Container builds react-native ESM
                                TX7.16 scenario 16: ESM has expected exports
                                TX7.17 scenario 17: cf-esm-cache serves library
                                TX7.18 scenario 18: native bundle has no react-native-web aliases
                                TX7.19 scenario 19: native bundle URLs point at cf-esm-cache
                                TX7.20 scenario 20: relay POST /publish → hash
                                TX7.21 scenario 21: relay GET /manifest/:hash valid
                                TX7.22a scenario 22a: synthetic editor → manifest e2e (orchestrator)
                                TX7.22b scenario 22b: real phone scan (human dead-letter)

                                Wave X8 — Phase Z' (SEQUENTIAL, 1 coordinator)
                                ──────────────────────────────────────────────
                                TX8.1 results.json refresh
                                TX8.2 reference screenshots for scenarios 15-22
                                TX8.3 README + status.md update
                                TX8.4 full lint+typecheck+test sweep
                                TX8.5 commit + push + PR description update
```

**Total task count:** 4 (X0) + 7 (X1) + 7 (X2) + 6 (X3) + 3 (X4) + 4 (X5) + 4 (X6) + 9 (X7) + 5 (X8) = **49 tasks** across 9 waves.

(Wave X3 grows by 1 from the new TX3.6 version-resolver task; Wave X7 grows by 1 from the TX7.22 → 22a/22b split. Counts per wave above are exact.)

With 8-agent concurrency and the dep gates, the realistic critical path is:

```
X0 sequential (~3 hours, 4 tasks)
  → spike result determines whether to proceed
  → contracts locked
X1+X2+X3 parallel fan-out (1.5 hours wall-time at 8 concurrent)
  → Container produces real library ESM
  → Worker routes refactored
  → browser-metro native mode lands
X4+X5+X6 parallel fan-out (1 hour wall-time)
  → cache serves the library prefix
  → relay accepts published bundles
  → editor flow flipped
X7 verification (1.5 hours — scenarios 15-21 are unit-style, scenario 22 is human + phone)
X8 sequential phase Z' (1 hour)
```

**Realistic wall time at 8 concurrent agents: 8–12 hours.**

---

## Wave X0 — Foundation (SEQUENTIAL, 1 agent)

**Cannot start Wave X1+ until Wave X0 fully merged AND TX0.1 spike comes back GREEN.**

| ID | Title | Files | Validate |
|---|---|---|---|
| **TX0.1** | **SPIKE: build react-native@0.81.0 as ESM, verify in Expo Go** | NEW: `apps/cf-esm-builder/container/spike/` (throwaway dir) — `spike.sh` that runs Metro against react-native, captures the output, prints exports. PLUS a tiny test fixture that imports from the spike output. PLUS manual phone-scan instructions. | `bash apps/cf-esm-builder/container/spike/spike.sh` exits 0 AND the printed exports include `View`, `Text`, `StyleSheet`, `AppRegistry`, `Platform`. THEN human runs the phone test and updates `plans/expo-browser-x-spike-result.md` with PASS/FAIL/PIVOT. **Phase X stops here if FAIL.** |
| **TX0.2** | Lock Phase X contracts | `plans/expo-browser-x-contracts.md` NEW (~150 lines) — defines: (a) library bundle ESM shape (named exports + module.exports?), (b) cf-esm-cache R2 layout for libraries, (c) browser-metro `target` option API + how URLs are constructed for native mode, (d) cf-expo-relay POST /publish protocol (multipart? raw JS? hash strategy?), (e) the new `usePreviewOnDevice` flow as a sequence diagram | `test -f plans/expo-browser-x-contracts.md && [ $(wc -l < plans/expo-browser-x-contracts.md) -gt 80 ]` |
| **TX0.3** | Status doc — architectural correction section | `plans/expo-browser-status.md` (append "## 2026-04-08 Phase X — corrective architecture" section explaining what was wrong, what's being changed, why, and pointer to this queue file) | `grep -q "Phase X" plans/expo-browser-status.md` |
| **TX0.4** | results.json schema — scenarios 15-22 stubs | `apps/web/client/verification/onlook-editor/results.json` (add not_yet_verified entries for 15-22 with title + queue_task fields) | `jq -e '.scenarios | keys | length >= 22' apps/web/client/verification/onlook-editor/results.json` |

**Wave X0 merge gate:**
- TX0.1 spike result is GREEN (or the queue stops)
- All 4 docs/contracts merged
- `bun run typecheck` clean

---

## Wave X1 — Container library bundling (PARALLEL, up to 5 concurrent)

**Goal:** Container that takes a `(name, version)` tuple on stdin and produces an ESM bundle for that npm package on `/output/index.mjs`. NO Metro. NO Hermes step. NO project bundling. Pure esbuild.

| ID | Title | Files (max edit scope) | Depends | Validate |
|---|---|---|---|---|
| **TX1.0** | Phase X deletions — clean up the per-project pipeline (HOTSPOT, sequential) | DELETE: `apps/cf-esm-builder/container/build.sh`, `container/lib/extract-source.sh`, `container/lib/run-metro.sh`, `container/lib/run-hermes.sh`, `container/__tests__/fixtures/minimal-expo/` (entire dir), `apps/web/client/src/services/expo-builder/source-tar.ts`, `apps/web/client/src/services/expo-builder/build-orchestrator.ts`, `scripts/seed-expo-fixture.ts` | TX0.* | After deletions, `bun run typecheck` exits 0 (some downstream files may need stub patches — add `// @ts-expect-error pending Phase X` markers if needed). Single commit. |
| **TX1.1** | `build-library.sh` entrypoint | NEW: `apps/cf-esm-builder/container/build-library.sh` (reads `{name, version}` JSON on stdin, validates the spec, calls `lib/build-library-esbuild.sh`, captures stdout/stderr, emits JSON `{ ok, bytes, exports[], elapsedMs }` to stdout. ~30 lines.) | TX1.0 | `bash -n container/build-library.sh && shellcheck container/build-library.sh` |
| **TX1.2** | esbuild library driver | NEW: `apps/cf-esm-builder/container/lib/build-library-esbuild.sh` (creates `/tmp/work-${rand}` temp dir, runs `npm install --no-package-lock --no-save ${name}@${version}`, resolves entry via `node -p "require.resolve('${name}', {paths:['/tmp/work-${rand}/node_modules']})"`, runs `esbuild $ENTRY --bundle --format=esm --platform=neutral --target=es2022 --external:react --external:react-dom --outfile=/output/index.mjs --metafile=/output/meta.json`, parses meta.json for byte count, parses ESM via a tiny node helper to capture export names, writes `/output/exports.json`) | TX1.0 | shellcheck clean + `bash container/lib/build-library-esbuild.sh react-native 0.81.0` produces a non-empty `/output/index.mjs` AND the export list in `/output/exports.json` includes `View`, `Text`, `StyleSheet`, `AppRegistry`, `Platform` |
| **TX1.3** | esbuild config helper | NEW: `apps/cf-esm-builder/container/lib/esbuild-library.config.mjs` (small JS module exporting an esbuild option object factory `(name, version) => esbuildOptions`. Defaults: format esm, platform neutral, target es2022, externals react+react-dom, sourcemap inline, minify false, mainFields module>main>browser, conditions module>import>require) | TX1.0 | `node -e "import('./container/lib/esbuild-library.config.mjs').then(m => console.log(typeof m.default))"` prints `function` |
| **TX1.4** | Dockerfile slim — drop Hermes + Expo CLI + Metro | `apps/cf-esm-builder/Dockerfile` (remove Hermes binary install, remove `@expo/cli` global, remove `expo` global, remove `metro`/`metro-resolver`/`@react-native/metro-config`. Keep: `node:20-alpine` base, `esbuild` binary install via `npm i -g esbuild@^0.24`, `npm` for package install, `bash`+`coreutils` for the shell scripts. Multi-stage so the final image only carries the runtime binaries.) | TX1.0 | `docker build -t cf-esm-builder:dev .` exits 0 AND `docker image inspect cf-esm-builder:dev --format '{{.Size}}'` ≤ 200 MB (down from 651 MB; target is ~150 MB) |
| **TX1.5** | Smoke test — react-native@0.81.0 → ESM | NEW: `apps/cf-esm-builder/container/__tests__/library-smoke.sh` (runs `echo '{"name":"react-native","version":"0.81.0"}' \| docker run -i cf-esm-builder:dev build-library`, asserts output JSON has `ok=true` AND `exports` array contains `View`, `Text`, `StyleSheet`, `AppRegistry`, `Platform`) | TX1.1, TX1.2, TX1.3, TX1.4 | `bash container/__tests__/library-smoke.sh` exits 0 |
| **TX1.6** | Library targets list | NEW: `apps/cf-esm-builder/container/library-targets.json` (canonical list of packages to pre-build: react@19.1.0, react-dom@19.1.0, react-native@0.81.0, react-native-web@0.21.0, expo@54.0.0, expo-status-bar@2.0.0, plus version metadata) | — | `jq -e '.libraries \| length >= 6' container/library-targets.json` |

**Wave X1 merge gate:** `docker run -i cf-esm-builder:dev build-library < {"name":"react-native","version":"0.81.0"}` produces a real ESM bundle with the expected exports.

---

## Wave X2 — cf-esm-builder Worker layer refactor (SEMI-PARALLEL, up to 6 concurrent)

| ID | Title | Files | Depends | Validate |
|---|---|---|---|---|
| **TX2.0** | Worker source deletions | DELETE: `apps/cf-esm-builder/src/routes/build.ts` (the source-tar version), `apps/cf-esm-builder/src/__tests__/routes/build.test.ts` | TX1.0 | typecheck clean (downstream worker.ts will reference deleted route — TX2.5 fixes that) |
| **TX2.1** | `routes/build-library.ts` (NEW) | NEW: `apps/cf-esm-builder/src/routes/build-library.ts` — `POST /build-library` accepts `{ name, version }` JSON body, computes `pkg-hash := sha256(name + '@' + version)`, checks R2 for `library/${name}/${version}/meta.json`, on hit returns cached, on miss kicks off BuildSession DO; NEW unit tests | TX2.0 | `bun test src/routes/build-library.test.ts` |
| **TX2.2** | BuildSession DO refactor | `apps/cf-esm-builder/src/do/build-session.ts` (replace tar-handling logic with library-handling: state machine becomes `pending → building → ready/failed` keyed by `(name, version)` instead of source hash; spawn Container with library JSON instead of tar) | TX2.0 | `bun test src/__tests__/do/build-session.test.ts` (existing tests refactored) |
| **TX2.3** | `lib/r2.ts` library helpers | `apps/cf-esm-builder/src/lib/r2.ts` (replace `r2GetBundle/r2PutBundle` for `bundle/<hash>/...` with `r2GetLibrary/r2PutLibrary` for `library/<pkg>/<version>/...`. Drop the bundle/<hash> codepaths.) | TX2.0 | `bun test src/__tests__/lib/r2.test.ts` |
| **TX2.4** | `lib/hash.ts` simplification | `apps/cf-esm-builder/src/lib/hash.ts` (drop `sha256OfTar`, keep just `sha256` for raw byte hashing — used by the library version key) | TX2.0 | `bun test src/__tests__/lib/hash.test.ts` |
| **TX2.5** | `worker.ts` router refactor | `apps/cf-esm-builder/src/worker.ts` (drop `POST /build` route, add `POST /build-library`, drop bundle GET routes — those move entirely to cf-esm-cache, keep `GET /health`) | TX2.1, TX2.2, TX2.3, TX2.4 | `bun run typecheck && bun test && bunx wrangler deploy --dry-run` |
| **TX2.6** | Pre-warm script | NEW: `scripts/prewarm-libraries.sh` (reads `apps/cf-esm-builder/container/library-targets.json`, POSTs each library to the deployed cf-esm-builder, polls until all are `ready`. Idempotent.) | TX2.5 | `bash -n scripts/prewarm-libraries.sh && shellcheck scripts/prewarm-libraries.sh` |

**Wave X2 merge gate:** `cd apps/cf-esm-builder && bun test && bunx wrangler deploy --dry-run` clean. The worker no longer references the per-project build path.

---

## Wave X3 — browser-metro native target (PARALLEL, up to 6 concurrent)

**Goal:** Add a `target: 'web' | 'native'` mode to BrowserMetro. Web mode is the existing Phase R behavior. Native mode skips the `react-native → react-native-web` alias and points URLs at cf-esm-cache.

| ID | Title | Files | Depends | Validate |
|---|---|---|---|---|
| **TX3.1** | Rewriter target mode + versions map | `packages/browser-metro/src/host/bare-import-rewriter.ts` (add `target: 'web' \| 'native'` AND `versions?: Map<string, string>` to `RewriteOptions`. Native mode: drop the `react-native → react-native-web` alias, switch URL prefix from `${esmUrl}` to `${esmUrl}/library`, drop the `?bundle&external=...` query, use `/${pkg}/${versions.get(pkg) ?? 'latest'}/index.mjs` style key. Sub-paths preserved as `/${pkg}/${version}/${subpath}`. Web mode unchanged.) | TX3.6 | `bun test packages/browser-metro/src/host/__tests__/bare-import-rewriter.test.ts` (add native mode + versions map cases) |
| **TX3.2** | Host types — target + versions options | `packages/browser-metro/src/host/types.ts` (add `target?: 'web' \| 'native'` (default `'web'`) AND `versions?: Map<string, string>` (default empty Map) to `BrowserMetroOptions`) | — | `bun run typecheck` |
| **TX3.3** | `host/index.ts` bundle({target, versions}) | `packages/browser-metro/src/host/index.ts` (bundle method passes target + versions through to rewriter; published BundleResult also gets a `target` field so subscribers know which mode it is) | TX3.1, TX3.2 | `bun test packages/browser-metro/src/__tests__/host.test.ts` |
| **TX3.4** | Native rewriter tests | `packages/browser-metro/src/host/__tests__/bare-import-rewriter.test.ts` (add 10 cases: native mode for react/react-native/react-native-web/expo-status-bar/scoped pkg/sub-path, plus 2 versions-map cases (resolved + fallback to `latest`), plus regression that web mode is unchanged) | TX3.1 | `bun test packages/browser-metro/src/host/__tests__/bare-import-rewriter.test.ts` |
| **TX3.5** | Host integration test — 3-file native bundle | `packages/browser-metro/src/__tests__/host.test.ts` (NEW test: bundle a 3-file fixture with `target: 'native'` AND a versions map of `{react: '19.1.0', react-native: '0.81.0'}`, assert no `react-native-web` URLs, assert all URLs match the cf-esm-cache `/library/<pkg>/<version>/index.mjs` pattern) | TX3.3, TX3.6 | `bun test packages/browser-metro` (full suite — must remain green) |
| **TX3.6** | Version resolver — read project package.json + lockfile | NEW: `apps/web/client/src/services/expo-builder/version-resolver.ts` (function `resolveDependencyVersions(fs: CodeFileSystem): Promise<Map<string, string>>` — reads `/package.json` for declared versions, then reads `/bun.lockb`/`/package-lock.json`/`/yarn.lock` (whichever exists) for the resolved concrete versions, returning a Map of `pkg → resolved version`. Falls back to a hard-coded default version map for the canonical 6 packages when neither file is present. NEW unit tests using an in-memory fs stub.) | — | `bun test apps/web/client/src/services/expo-builder/__tests__/version-resolver.test.ts` |

**Wave X3 merge gate:** `bun test packages/browser-metro` green AND version-resolver test green. Both web AND native bundle outputs verified by tests, with concrete version resolution from a project's lockfile.

---

## Wave X4 — cf-esm-cache library prefix (PARALLEL, up to 3 concurrent)

| ID | Title | Files | Depends | Validate |
|---|---|---|---|---|
| **TX4.1** | `worker.ts` library routing | `apps/cf-esm-cache/src/worker.ts` (replace `/bundle/:hash` proxy with `/library/:pkg/:version/:filename` proxy; cache-first against R2; on miss, fetch from cf-esm-builder service binding via `/build-library` POST; SWR semantics) | TX2.5 | `cd apps/cf-esm-cache && bun test && bunx wrangler deploy --dry-run` |
| **TX4.2** | `routes/invalidate.ts` library version | `apps/cf-esm-cache/src/routes/invalidate.ts` (accept `{pkg, version}` instead of `{hash}`; deletes `library/<pkg>/<version>/*`) | TX4.1 | `bun test src/routes/__tests__/invalidate.test.ts` |
| **TX4.3** | wrangler.jsonc — library R2 prefix env | `apps/cf-esm-cache/wrangler.jsonc` (add `LIBRARY_R2_PREFIX=library` env var, document in comment) | TX4.1 | `bunx wrangler deploy --dry-run` clean |

**Wave X4 merge gate:** Local `wrangler dev` against cf-esm-cache + cf-esm-builder shows a `GET /library/react/19.1.0/index.mjs` round-trip working end-to-end, hitting Container on first request, cache on subsequent.

---

## Wave X5 — cf-expo-relay POST /publish (PARALLEL, up to 4 concurrent)

| ID | Title | Files | Depends | Validate |
|---|---|---|---|---|
| **TX5.1** | `routes/publish.ts` (NEW) | NEW: `apps/cf-expo-relay/src/routes/publish.ts` — `POST /publish` accepts a JS bundle on the body (Content-Type: application/javascript), hashes it (sha256), stores at `published/${hash}/bundle.js` in R2, also stores a synthesized `published/${hash}/manifest-fields.json` with sensible defaults, returns `{ bundleHash, manifestUrl }`; NEW unit tests | — | `bun test src/__tests__/routes/publish.test.ts` |
| **TX5.2** | `lib/r2.ts` — published bundle helpers | NEW: `apps/cf-expo-relay/src/lib/r2.ts` — `r2PutPublishedBundle`, `r2GetPublishedBundle`, `r2GetPublishedManifestFields` for the `published/` prefix | — | `bun test src/__tests__/lib/r2.test.ts` |
| **TX5.3** | `routes/manifest.ts` swap source | `apps/cf-expo-relay/src/routes/manifest.ts` (change the manifest endpoint to read from `published/${bundleHash}/manifest-fields.json` instead of going through cf-esm-cache; `launchAsset.url` points at `${RELAY_PUBLIC_URL}/bundle/${bundleHash}` instead of cf-esm-cache) | TX5.1, TX5.2 | `bun test src/__tests__/routes/manifest.test.ts` |
| **TX5.4** | `wrangler.jsonc` published-bundles R2 binding | `apps/cf-expo-relay/wrangler.jsonc` (add `published-bundles` R2 bucket binding, document) | TX5.1, TX5.2 | `bunx wrangler deploy --dry-run` clean |

**Wave X5 merge gate:** `cd apps/cf-expo-relay && bun test && bunx wrangler deploy --dry-run` clean. Local POST → publish → GET /manifest → GET /bundle round-trip works against an in-memory R2 stub.

---

## Wave X6 — Editor flow refactor (SEMI-SERIAL, max 4 concurrent)

| ID | Title | Files | Depends | Validate |
|---|---|---|---|---|
| **TX6.1** | `services/expo-relay/publish-client.ts` (NEW) | NEW: `apps/web/client/src/services/expo-relay/publish-client.ts` — HTTP client for `POST /publish`. Single function `publishBundle(jsBundle: string, opts: { relayBaseUrl: string }): Promise<{ bundleHash: string; manifestUrl: string }>`. NEW unit tests using msw or stub fetch. | TX5.1 | `bun test src/services/expo-relay/__tests__/publish-client.test.ts` |
| **TX6.2** | `usePreviewOnDevice` refactor + status states | `apps/web/client/src/hooks/use-preview-on-device.tsx` (replace the source-tar → builder POST → poll path with: `resolveDependencyVersions(fs)` → `BrowserMetro.bundle({target:'native', versions})` → `publishBundle(result.iife)` → manifest URL → render QR. **Extend the status discriminator** with two new states: `{ kind: 'resolving-versions' }` and `{ kind: 'compiling-libraries', missing: string[] }`. The compiling-libraries state fires when the rewriter detects a bare-import URL whose `library/<pkg>/<version>/index.mjs` returns 202/404 from cf-esm-cache (cache miss → Container is building it on demand). The hook polls cf-esm-cache until those return 200 then proceeds to publish. UI consumes the `missing` list to show "Compiling react-native-svg... ~30s".) | TX3.3, TX3.6, TX6.1 | `bun test apps/web/client/src/hooks/__tests__/use-preview-on-device.test.tsx` (cover all 6 status states: idle, resolving-versions, preparing, compiling-libraries, building, ready, error) |
| **TX6.3** | `preview-on-device-button.tsx` env wiring | `apps/web/client/src/app/project/[id]/_components/top-bar/preview-on-device-button.tsx` (drop the unused builderBaseUrl env, just pass relayBaseUrl + the editor's BrowserMetro instance from the SandboxManager) | TX6.2 | `bun test apps/web/client/src/app/project/[id]/_components/top-bar/__tests__/preview-on-device-button.test.tsx` |
| **TX6.4** | `services/expo-builder/` directory cleanup | DELETE: every file under `apps/web/client/src/services/expo-builder/` EXCEPT `version-resolver.ts` and its `__tests__/version-resolver.test.ts` (which are NEW in TX3.6 and remain in use). Specifically delete `source-tar.ts`, `build-orchestrator.ts`, `builder-client.ts`, `types.ts` (and any companion test files). | TX6.2, TX3.6 | `bun run typecheck` clean AND `find apps/web/client/src/services/expo-builder -type f` returns ONLY `version-resolver.ts` + its test file |

**Wave X6 merge gate:** `bun test apps/web/client/src/services/expo-relay apps/web/client/src/hooks apps/web/client/src/app/project` green. Editor compiles and the preview-on-device button still renders.

---

## Wave X7 — Verification scenarios (PARALLEL, up to 8 concurrent)

Each scenario is a markdown spec at `apps/web/client/verification/onlook-editor/scenarios/<NN>-<slug>.md` walked by the orchestrator via Chrome MCP (or curl-style for the unit-shaped ones).

| ID | Scenario | What it asserts | Method | Validate |
|---|---|---|---|---|
| **TX7.15** | 15: Container builds react-native ESM | `docker run cf-esm-builder:dev build-library` with `{"name":"react-native","version":"0.81.0"}` returns ok=true, /output/index.mjs is non-empty + valid ESM | bash + docker | `jq -e '.scenarios["15"].state == "passed"' results.json` |
| **TX7.16** | 16: ESM has expected exports | `node -e "import * as RN from '/tmp/lib-out/index.mjs'; console.log(Object.keys(RN))"` includes View, Text, StyleSheet, AppRegistry, Platform | bash + node | gate as above |
| **TX7.17** | 17: cf-esm-cache serves library | `curl http://127.0.0.1:8789/library/react-native/0.81.0/index.mjs` returns 200 application/javascript with non-empty body | curl | gate |
| **TX7.18** | 18: native bundle has no react-native-web aliases | Construct a minimal in-memory CodeFileSystem with App.tsx, call `BrowserMetro.bundle({target:'native'})`, assert `result.iife` does NOT contain `react-native-web` substring | bun test fixture | gate |
| **TX7.19** | 19: native bundle URLs point at cf-esm-cache | Same fixture, assert `result.iife` contains `library/react/` AND `library/react-native/` URL substrings | bun test fixture | gate |
| **TX7.20** | 20: relay POST /publish → hash | `curl -X POST http://127.0.0.1:8787/publish` with a 1KB JS body, returns `{bundleHash, manifestUrl}` with a 64-char hex hash | curl | gate |
| **TX7.21** | 21: relay GET /manifest/:hash valid | `curl http://127.0.0.1:8787/manifest/<hash>` returns valid Expo manifest with `launchAsset.url` containing `/bundle/<hash>` | curl | gate |
| **TX7.22a** | 22a: synthetic editor → manifest end-to-end | Chrome MCP walk: open editor → click Preview on device → modal renders QR → orchestrator calls `curl <manifestUrl>` → asserts valid Expo manifest JSON → asserts `curl <manifest.launchAsset.url>` returns 200 application/javascript with `>10KB` body → asserts the body contains `View` and `AppRegistry` substrings (proof the bundle was produced by the new browser-metro native target). NO real phone needed. | Chrome MCP + curl | results.json scenarios["22a"].state == "passed", verified_by="orchestrator" |
| **TX7.22b** | 22b: real phone scan (human-only dead-letter) | Identical to 22a's setup, but the final step is a human pointing a phone running Expo Go at the QR code and confirming the fixture text renders. This is the only Phase X scenario that requires hardware. Marked as `verified_by: human` and lives in a separate ledger so the orchestrator never auto-fails on it. | Human phone | results.json scenarios["22b"].state == "passed" AND verified_by="human" AND a `human_verified_at` ISO timestamp present |

**Wave X7 merge gate:** Scenarios 15-21 + 22a all `passed` in `results.json` via the orchestrator. Scenario 22b is tracked separately and does NOT block Wave X8 — it only blocks the final PR-merge claim of "Expo Go end-to-end verified on real hardware."

---

## Wave X8 — Phase Z' final integration (SEQUENTIAL, 1 coordinator)

| ID | Title | Files | Validate |
|---|---|---|---|
| **TX8.1** | `results.json` final state | `apps/web/client/verification/onlook-editor/results.json` (flip 15-22 to passed; old scenarios 08, 09, 10, 12, 13 STAY passed because they verified the architecture-as-of-PR-#9, but add a `phase` field marking them `phase: "H-original"` and 15-22 as `phase: "X"`; preserve the historical record) | `jq -e '[.scenarios | to_entries[] | .value.state == "passed"] \| all'` |
| **TX8.2** | Reference screenshots for 15-22 | `apps/web/client/verification/onlook-editor/reference/15-22-*.png` | `for n in 15 16 17 18 19 20 21 22; do test -s reference/$n-*.png; done` |
| **TX8.3** | README + status doc updates | `apps/web/client/verification/onlook-editor/README.md` (add Phase X scenario rows + "How to scan" updated for the new browser-metro path); `plans/expo-browser-status.md` (Phase X completion section) | `grep -q "Phase X complete" plans/expo-browser-status.md` |
| **TX8.4** | Full sweep | — | `bun run lint && bun run typecheck && bun test && bun test packages/browser-metro packages/code-provider apps/cf-esm-builder apps/cf-esm-cache apps/cf-expo-relay apps/web/client/src/services apps/web/client/src/hooks` |
| **TX8.5** | PR description update + push | — | `gh pr edit 9 --body "<updated>"` and `gh pr ready 9` |

---

## Per-task agent prompt template (delta from parent)

Same shape as `plans/expo-browser-e2e-task-queue.md`'s template. Phase X-specific additions:

```
Phase X context:
- Source plan:    plans/expo-browser-implementation.md
- Parent queue:   plans/expo-browser-task-queue.md
- Phase R/H/Q:    plans/expo-browser-e2e-task-queue.md
- This queue:     plans/expo-browser-x-queue.md
- Spike result:   plans/expo-browser-x-spike-result.md (must be GREEN before any X1+ work)
- Status:         plans/expo-browser-status.md (Phase X corrective architecture section)
- Contracts:      plans/expo-browser-x-contracts.md (locked by TX0.2)

Validation environment:
- Dev server:        scripts/start-verify-server.sh
- Local builder:     scripts/dev-builder.sh (refactored — now serves /build-library)
- Local relay:       scripts/dev-relay.sh
- Local shims:       scripts/local-builder-shim.ts (DEPRECATED — Phase X removes)
                     scripts/local-relay-shim.ts   (DEPRECATED — Phase X removes)

Spike-result gate (REQUIRED first action for any Wave X1+ task):
Before doing ANY work, read plans/expo-browser-x-spike-result.md.
If the file does not exist OR does not contain a line matching `^RESULT: PASS$`,
exit immediately with status "blocked-on-spike". Do NOT make any edits.

  grep -q '^RESULT: PASS$' plans/expo-browser-x-spike-result.md || {
    echo "blocked-on-spike: TX0.1 has not passed yet" >&2
    exit 78  # EX_CONFIG — task is blocked, not failed
  }

Architectural integrity check (REQUIRED for every Phase X task):
After your changes, run:
    jq -e '[.scenarios | to_entries[] | select(.key | test("^(06|07|08|09|10|11|12|13)$")) | .value.state == "passed"] | all' \
       apps/web/client/verification/onlook-editor/results.json
This MUST return true. Phase X must not regress the existing 13 passing scenarios.
If it returns false, your task is dead-lettered.

NEVER fake a passing assertion.
NEVER mark a scenario passed without real evidence.
"NOT YET VERIFIED IN BROWSER" is the honest answer when something can't be walked.
```

---

## Failure handling (delta from parent)

Inherit the parent queue's per-task retry policy + per-merge integration check + hotspot file lock table + dead-letter ledger.

**Phase X-specific failure modes:**

| Failure | Action |
|---|---|
| TX0.1 spike fails (Container can't build a working react-native ESM) | **Stop the queue.** Open a follow-up plan exploring (a) shimming RN globals from the editor side, (b) using a different runtime than Expo Go, (c) sticking with the Phase H Container path as-is and only fixing the per-preview cost via better caching. Do not proceed with X1+. |
| Wave X1+ task regresses scenario 06/07 (Phase R canvas iframe) | Dead-letter immediately. The integrity check in the agent prompt prevents merge but if it slips through, revert the merge from `feat/expo-browser-provider`. |
| BuildSession DO refactor breaks Container TCP protocol | TX2.2 dead-letters; TX2.5 (worker.ts router) blocks until fixed |
| Native bundle URL pattern doesn't match cf-esm-cache routing | TX3.1 + TX4.1 are inter-locked — flag both for re-coordination, possibly need a per-version vs per-major URL pattern decision |
| Phone (Expo Go) can't load the browser-metro native bundle even though all unit tests pass | This is a TX0.1 spike failure surfacing late. Roll back Wave X6 + X7. Reopen the spike. |

**Per-merge integration check (mandatory):**
After every merge to `feat/expo-browser-provider`, run:
```bash
bun run typecheck && bun test && \
jq -e '[.scenarios | to_entries[] | select(.key | test("^(06|07|08|09|10|11|12|13)$")) | .value.state == "passed"] | all' \
   apps/web/client/verification/onlook-editor/results.json
```
The integrity check ensures Phase X doesn't break Phase R/H/Q. If it fails, `git revert HEAD` immediately.

---

## Open questions — RESOLVED (2026-04-08)

1. **Spike outcome dependence.** RESOLVED → Hard marker file `plans/expo-browser-x-spike-result.md` MUST contain the literal string `RESULT: PASS` on its own line. Every Wave X1+ agent's prompt template includes a first-action check that reads this file and exits if it's missing or contains `RESULT: FAIL`. The orchestrator holds the queue in `blocked-on-spike` until the marker exists. The marker file's full schema is documented in `plans/expo-browser-x-contracts.md` (locked by TX0.2).

2. **Existing PR #9 status.** RESOLVED → Phase X commits land on top of the same `feat/expo-browser-provider` branch. The PR description (updated by TX8.5) describes BOTH the original Phase H/Q (Container works for one-shot bundles, kept as a "shareable immutable preview link" use case) AND the Phase X corrective architecture (per-preview path works without Container). The PR ships both paths.

3. **`react-native` ESM bundling — what tool produces it?** RESOLVED → **esbuild**, not Metro. Reasoning: Metro is an app bundler designed for platform-specific JSC/Hermes payloads with the RN runtime baked in; it has no first-class library mode. esbuild has first-class CJS-to-ESM conversion, can produce a neutral ESM artifact for `react-native` in ~1-2s, and keeps the Container image to ~150MB (vs 651MB with Metro+Hermes baked in). Build script is ~30 lines:
   ```bash
   esbuild "$ENTRY" --bundle --format=esm --platform=neutral --target=es2022 \
       --external:react --external:react-dom --outfile=/output/index.mjs \
       --metafile=/output/meta.json --conditions=module,import,require
   ```
   TX1.1-TX1.5 are written against this. TX0.1 spike validates the assumption empirically before any X1+ work begins.

4. **Versioning the library cache.** RESOLVED → Browser-metro reads versions from the project's local CodeFileSystem (via the new TX3.6 `version-resolver.ts` service). Resolution order: (a) `bun.lockb` / `package-lock.json` / `yarn.lock` (concrete versions), (b) `package.json` declared versions (best effort), (c) hard-coded fallback map for the canonical 6 packages. The resolver returns a `Map<string, string>` that the rewriter consumes via the new `versions` constructor option (TX3.1). URL pattern is `library/<pkg>/<version>/index.mjs` with `latest` as the only fallback string.

5. **Cache miss + library not pre-warmed → first-build cost.** RESOLVED → Two-layer mitigation:
   - **Layer A (pre-warm covers ~90%):** TX1.6 + TX2.6 ensure the canonical 6 packages (react, react-dom, react-native, react-native-web, expo, expo-status-bar) are always pre-built. Most projects only use these.
   - **Layer B (uncommon dep UX):** TX6.2 extends the hook's status discriminator with a `{ kind: 'compiling-libraries', missing: string[] }` sub-state. The hook polls cf-esm-cache for each missing library URL; while any return 202/404, the UI shows "Compiling react-native-svg... ~30s". When all return 200, the hook proceeds to publish. No silent hang.

6. **Scenario 22 requires a real phone.** RESOLVED → Split into TX7.22a (synthetic curl-based, walked by orchestrator, blocks Wave X8) and TX7.22b (real phone, human-only, separate ledger, does NOT block Wave X8). Phase X completion is signaled when 22a passes; the "Expo Go on real hardware verified" claim is signaled when 22b passes.

7. **Wave X8 commit strategy.** RESOLVED → Every Wave Xn task lands as a single squash commit on `feat/expo-browser-provider` so reverts are surgical. The integration commit on each merge captures the wave name in the message footer (`Wave: X3`) so `git log --grep "Wave: X3"` reproduces the slice.
