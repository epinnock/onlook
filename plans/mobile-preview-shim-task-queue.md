# Mobile Preview Shim — Parallel Task Queue

**Source plans:** `plans/mobile-preview-shim-implementation.md` is the canonical scope doc. `plans/mobile-preview-gap-analysis.md` and `plans/mobile-preview-shim-references.md` are the supporting context. This file is the execution queue for Codex-style parallel work.

**Scope of this queue:** everything through `### Workstream G — Hardening & polish`. This queue deliberately stops before Android parity and Cloudflare deployment.

**Goal:** maintain a long queue of small, file-scoped tasks that can be pulled by up to 8 parallel agents working in isolated git worktrees, with deterministic E2E validation at every merge gate.

## Adaptation for Codex

The original workstream plan assumed Claude-style operator loops and some manual device checks. For Codex and worktree-based parallelism:

- Every task must be claimable in a separate git worktree.
- Acceptance is driven by `bun` unit tests plus Playwright E2E, not ad hoc device poking.
- Real-phone validation becomes a milestone smoke check, not a per-task gate.
- Hotspot files are split first so later tasks can actually run in parallel.

## Decomposition rules

- One file, one owner within a wave.
- Default task size is 1 file, sometimes 2 to 3 tightly related files.
- Shared registries must be auto-discovered or code-generated so package tasks do not fight over one export file.
- Agents merge only to `feat/mobile-preview-shim`, never directly to `main`.
- Generated artifacts are not edited by workers. That includes `packages/mobile-preview/runtime/bundle.js`.
- Retry failures up to 3 times with test output fed back into the worker. Then dead-letter the task.

## Worktree conventions

### Integration branch

```bash
git checkout -b feat/mobile-preview-shim main
```

### Worktree layout

```bash
.trees/
├── MP0-01-e2e-config/
├── MPA-03-react-native-shim/
├── MPB-04-textinput-events/
└── ...
```

### Worktree creation

```bash
git worktree add -b ai/<task-id>-<slug> .trees/<task-id>-<slug> feat/mobile-preview-shim
cd .trees/<task-id>-<slug>
bun install
```

### Task brief

The orchestrator should write a short `TASK.md` into each worktree:

```md
# <task-id>

Allowed files:
- <file-1>
- <file-2>

Validation:
- <command>
```

This replaces Claude-specific per-worktree rules. If a task needs more files, split it or escalate it.

### Port allocation

Eight worktrees can run in parallel only if their dev servers do not collide.

| Slot | Web app | Mobile HTTP | Mobile WS |
|---|---|---|---|
| 0 | 3100 | 8787 | 8887 |
| 1 | 3101 | 8788 | 8888 |
| 2 | 3102 | 8789 | 8889 |
| 3 | 3103 | 8790 | 8890 |
| 4 | 3104 | 8791 | 8891 |
| 5 | 3105 | 8792 | 8892 |
| 6 | 3106 | 8793 | 8893 |
| 7 | 3107 | 8794 | 8894 |

Per worktree, export:

```bash
export MOBILE_PREVIEW_SLOT=3
export WEB_PORT=$((3100 + MOBILE_PREVIEW_SLOT))
export MOBILE_PREVIEW_PORT=$((8787 + MOBILE_PREVIEW_SLOT))
export MOBILE_PREVIEW_WS_PORT=$((8887 + MOBILE_PREVIEW_SLOT))
export PLAYWRIGHT_BASE_URL="http://127.0.0.1:${WEB_PORT}"
export NEXT_PUBLIC_MOBILE_PREVIEW_URL="http://127.0.0.1:${MOBILE_PREVIEW_PORT}"
```

## Validation model

### Local task validate

After Wave 0 lands, every task uses the same shape:

```bash
bun run typecheck
bun test <task-specific-test>
bunx playwright test <task-specific-spec>
```

### Merge gate

Each wave has a smaller set of stable E2E specs. Individual tasks can use a narrow spec, but merges into `feat/mobile-preview-shim` only happen after the wave gate passes.

### E2E location

Add all new mobile-preview specs under:

```text
apps/web/client/e2e/mobile-preview/
```

Suggested structure after Wave 0:

```text
apps/web/client/e2e/mobile-preview/
├── helpers/
├── runtime/
├── interactions/
├── components/
├── styles/
├── expo-sdk/
├── third-party/
└── hardening/
```

## DAG overview

```text
Wave 0  Parallelism foundation            (mostly sequential)
  └─ unlocks registry auto-discovery, port-safe E2E, hotspot splits

Wave A  Runtime plumbing                  (parallel up to 8)
  └─ blocks B, D, most of E, and G

Wave B  Event bridge                      (parallel up to 6)
  └─ feeds C, F, and G regression specs

Wave C  Core RN mappings                  (parallel up to 6)
  └─ can start once A is in; TextInput tasks depend on B

Wave D  Style coverage                    (parallel up to 6)
  └─ can run alongside B and C

Wave E  Expo SDK packages                 (parallel up to 8)
  └─ depends on A NativeModules bridge; some packages depend on B/C

Wave F  Third-party UI libraries          (parallel up to 8)
  └─ depends on A and B; some tasks depend on C and E

Wave G  Hardening & polish                (parallel up to 6)
  └─ starts after A; regression suite finishes after B-F
```

## Wave 0 — Parallelism Foundation

This wave exists to make the rest of the queue actually parallelizable. Do not skip it.

| ID | Title | Files | Depends | Validate |
|---|---|---|---|---|
| `MP0-01` | Make Playwright base URL slot-aware | `apps/web/client/playwright.config.ts`, `apps/web/client/package.json` | — | `bun --filter @onlook/web-client run test:e2e -- --list` |
| `MP0-02` | Add worktree-safe dev launcher | `scripts/mobile-preview/start-stack.sh`, `scripts/mobile-preview/stop-stack.sh` | `MP0-01` | `bash scripts/mobile-preview/start-stack.sh 0` |
| `MP0-03` | Seed mobile-preview E2E fixture app | `apps/web/client/e2e/mobile-preview/helpers/fixture.ts`, `apps/web/client/e2e/mobile-preview/helpers/seed-fixture.ts` | `MP0-02` | `bun test apps/web/client/e2e/mobile-preview/helpers/fixture.ts` |
| `MP0-04` | Split editor bundler hotspot into submodules | `apps/web/client/src/services/mobile-preview/index.ts`, `apps/web/client/src/services/mobile-preview/bundler/*` | — | `bun test apps/web/client/src/services/mobile-preview/__tests__/index.test.ts` |
| `MP0-05` | Split Fabric host config into registries | `packages/mobile-preview/runtime/fabric-host-config.js`, `packages/mobile-preview/runtime/host/*` | — | `bun test packages/mobile-preview/runtime/__tests__/host-config.test.ts` |
| `MP0-06` | Split shell bootstrap into focused modules | `packages/mobile-preview/runtime/shell.js`, `packages/mobile-preview/runtime/bootstrap/*` | — | `bun test packages/mobile-preview/runtime/__tests__/shell.test.ts` |
| `MP0-07` | Split server into manifest, runtime-store, relay, status modules | `packages/mobile-preview/server/index.ts`, `packages/mobile-preview/server/*` | — | `bun test packages/mobile-preview/server/__tests__/server.test.ts` |
| `MP0-08` | Scaffold mobile-preview E2E directories and baseline smoke specs | `apps/web/client/e2e/mobile-preview/runtime/smoke.spec.ts`, `apps/web/client/e2e/mobile-preview/helpers/*` | `MP0-01`, `MP0-02`, `MP0-03` | `bunx playwright test apps/web/client/e2e/mobile-preview/runtime/smoke.spec.ts` |

**Wave 0 merge gate:** `bun run typecheck`, `bun test apps/web/client/src/services/mobile-preview`, `bun test packages/mobile-preview`, and `bunx playwright test apps/web/client/e2e/mobile-preview/runtime/smoke.spec.ts` all pass.

## Wave A — Runtime Plumbing

The key design decision in this wave is that shim modules become file-based and auto-discovered. That removes the central-export hotspot and lets package tasks run independently later.

| ID | Title | Files | Depends | Validate |
|---|---|---|---|---|
| `MPA-01` | Add shim registry loader and auto-discovery | `packages/mobile-preview/runtime/registry.js`, `packages/mobile-preview/server/build-runtime.ts` | `MP0-05`, `MP0-07` | `bun test packages/mobile-preview/runtime/__tests__/registry.test.ts` |
| `MPA-02` | Extract shared color and style helpers | `packages/mobile-preview/runtime/shims/core/style.js`, `apps/web/client/src/services/mobile-preview/bundler/wrap-eval-bundle.ts` | `MP0-04`, `MPA-01` | `bun test apps/web/client/src/services/mobile-preview/__tests__/style-shim.test.ts` |
| `MPA-03` | Extract `react-native` shim to file module | `packages/mobile-preview/runtime/shims/core/react-native.js` | `MPA-01`, `MPA-02` | `bun test apps/web/client/src/services/mobile-preview/__tests__/react-native-shim.test.ts` |
| `MPA-04` | Extract `react-native-safe-area-context` shim | `packages/mobile-preview/runtime/shims/core/react-native-safe-area-context.js` | `MPA-01` | `bun test apps/web/client/src/services/mobile-preview/__tests__/safe-area-shim.test.ts` |
| `MPA-05` | Extract `expo-status-bar` shim | `packages/mobile-preview/runtime/shims/expo/expo-status-bar.js` | `MPA-01` | `bun test apps/web/client/src/services/mobile-preview/__tests__/expo-status-bar-shim.test.ts` |
| `MPA-06` | Extract `expo-router` and preload no-op shims | `packages/mobile-preview/runtime/shims/expo/expo-router.js`, `packages/mobile-preview/runtime/shims/core/onlook-preload-script.js` | `MPA-01` | `bun test apps/web/client/src/services/mobile-preview/__tests__/expo-router-shim.test.ts` |
| `MPA-07` | Teach bundler `__require` to check runtime registry first | `apps/web/client/src/services/mobile-preview/bundler/wrap-eval-bundle.ts` | `MPA-03`, `MPA-04`, `MPA-05`, `MPA-06` | `bun test apps/web/client/src/services/mobile-preview/__tests__/registry-require.test.ts` |
| `MPA-08` | Add `NativeModules` and `TurboModuleRegistry` passthrough | `packages/mobile-preview/runtime/shims/core/native-modules.js`, `packages/mobile-preview/runtime/runtime.js` | `MPA-03` | `bun test packages/mobile-preview/runtime/__tests__/native-modules.test.ts` |
| `MPA-09` | Add asset resolution for image imports | `apps/web/client/src/services/mobile-preview/bundler/asset-loader.ts`, `apps/web/client/src/services/mobile-preview/bundler/module-code.ts` | `MP0-04` | `bun test apps/web/client/src/services/mobile-preview/__tests__/asset-loader.test.ts` |
| `MPA-10` | Tag runtime build with Expo SDK version metadata | `packages/mobile-preview/server/build-runtime.ts`, `packages/mobile-preview/server/runtime-store.ts` | `MP0-07` | `bun test packages/mobile-preview/server/__tests__/runtime-store.test.ts` |
| `MPA-11` | Reject preview opens on SDK mismatch | `apps/web/client/src/hooks/use-mobile-preview-status.tsx`, `apps/web/client/src/services/mobile-preview/types.ts` | `MPA-10` | `bun test apps/web/client/src/hooks/__tests__/use-mobile-preview-status.test.tsx` |
| `MPA-12` | Forward `evalError` from runtime to editor-visible status | `packages/mobile-preview/runtime/bootstrap/messages.js`, `packages/mobile-preview/server/relay.ts`, `apps/web/client/src/hooks/use-mobile-preview-status.tsx` | `MP0-06`, `MP0-07` | `bun test packages/mobile-preview/server/__tests__/relay.test.ts && bun test apps/web/client/src/hooks/__tests__/use-mobile-preview-status.test.tsx` |
| `MPA-E1` | E2E: runtime shim boot and initial push | `apps/web/client/e2e/mobile-preview/runtime/boot-and-push.spec.ts` | `MP0-08`, `MPA-07` | `bunx playwright test apps/web/client/e2e/mobile-preview/runtime/boot-and-push.spec.ts` |
| `MPA-E2` | E2E: local asset renders in preview flow | `apps/web/client/e2e/mobile-preview/runtime/assets.spec.ts` | `MP0-08`, `MPA-09` | `bunx playwright test apps/web/client/e2e/mobile-preview/runtime/assets.spec.ts` |
| `MPA-E3` | E2E: SDK mismatch fails with clear message | `apps/web/client/e2e/mobile-preview/runtime/sdk-mismatch.spec.ts` | `MP0-08`, `MPA-11` | `bunx playwright test apps/web/client/e2e/mobile-preview/runtime/sdk-mismatch.spec.ts` |
| `MPA-E4` | E2E: eval errors surface in editor status | `apps/web/client/e2e/mobile-preview/runtime/eval-errors.spec.ts` | `MP0-08`, `MPA-12` | `bunx playwright test apps/web/client/e2e/mobile-preview/runtime/eval-errors.spec.ts` |

**Wave A merge gate:** `MPA-E1` through `MPA-E4` pass together.

## Wave B — Event Bridge

Wave B assumes `packages/mobile-preview/runtime/host/events.js` exists after Wave 0. Keep event state there, not in `fabric-host-config.js`.

| ID | Title | Files | Depends | Validate |
|---|---|---|---|---|
| `MPB-01` | Register Fabric event handler and route into host events module | `packages/mobile-preview/runtime/host/events.js`, `packages/mobile-preview/runtime/fabric-host-config.js` | `MP0-05`, `MP0-06` | `bun test packages/mobile-preview/runtime/__tests__/events-register.test.ts` |
| `MPB-02` | Create instance-time handler map by tag and event name | `packages/mobile-preview/runtime/host/instance.js`, `packages/mobile-preview/runtime/host/events.js` | `MPB-01` | `bun test packages/mobile-preview/runtime/__tests__/event-registry.test.ts` |
| `MPB-03` | Refresh handler map during commit updates | `packages/mobile-preview/runtime/host/update.js`, `packages/mobile-preview/runtime/host/events.js` | `MPB-02` | `bun test packages/mobile-preview/runtime/__tests__/event-update.test.ts` |
| `MPB-04` | Build synthetic RN-style event payload factory | `packages/mobile-preview/runtime/host/synthetic-event.js` | `MPB-01` | `bun test packages/mobile-preview/runtime/__tests__/synthetic-event.test.ts` |
| `MPB-05` | Implement parent-chain bubbling for touchables and pressables | `packages/mobile-preview/runtime/host/bubbling.js`, `packages/mobile-preview/runtime/host/events.js` | `MPB-02`, `MPB-04` | `bun test packages/mobile-preview/runtime/__tests__/bubbling.test.ts` |
| `MPB-06` | Wire press events for `Touchable*`, `Pressable`, and `Button` | `packages/mobile-preview/runtime/host/events-press.js` | `MPB-04`, `MPB-05` | `bun test packages/mobile-preview/runtime/__tests__/press-events.test.ts` |
| `MPB-07` | Add `TextInput` change event dispatch | `packages/mobile-preview/runtime/host/events-text-input.js` | `MPB-04` | `bun test packages/mobile-preview/runtime/__tests__/text-input-events.test.ts` |
| `MPB-08` | Add controlled `TextInput` value sync | `packages/mobile-preview/runtime/host/components/text-input-control.js` | `MPB-07` | `bun test packages/mobile-preview/runtime/__tests__/text-input-control.test.ts` |
| `MPB-09` | Add `ScrollView` scroll event payloads | `packages/mobile-preview/runtime/host/events-scroll.js` | `MPB-04` | `bun test packages/mobile-preview/runtime/__tests__/scroll-events.test.ts` |
| `MPB-E1` | E2E: press interactions fire across touchable families | `apps/web/client/e2e/mobile-preview/interactions/press.spec.ts` | `MP0-08`, `MPB-06` | `bunx playwright test apps/web/client/e2e/mobile-preview/interactions/press.spec.ts` |
| `MPB-E2` | E2E: text input round-trip works | `apps/web/client/e2e/mobile-preview/interactions/text-input.spec.ts` | `MP0-08`, `MPB-08` | `bunx playwright test apps/web/client/e2e/mobile-preview/interactions/text-input.spec.ts` |
| `MPB-E3` | E2E: scroll events produce content offset updates | `apps/web/client/e2e/mobile-preview/interactions/scroll.spec.ts` | `MP0-08`, `MPB-09` | `bunx playwright test apps/web/client/e2e/mobile-preview/interactions/scroll.spec.ts` |

**Wave B merge gate:** `MPB-E1` through `MPB-E3` pass together.

## Wave C — Core RN Native-Type Mappings

Wave C relies on per-component files under `packages/mobile-preview/runtime/host/components/`. Each task owns one component file.

| ID | Title | Files | Depends | Validate |
|---|---|---|---|---|
| `MPC-01` | Add component mapping registry with auto-discovery | `packages/mobile-preview/runtime/host/components/index.js`, `packages/mobile-preview/runtime/host/instance.js` | `MP0-05` | `bun test packages/mobile-preview/runtime/__tests__/component-registry.test.ts` |
| `MPC-02` | Map `ScrollView` to `RCTScrollView` | `packages/mobile-preview/runtime/host/components/scroll-view.js` | `MPC-01`, `MPB-09` | `bun test packages/mobile-preview/runtime/__tests__/scroll-view.test.ts` |
| `MPC-03` | Map `Image` to `RCTImageView` with URI and resize mode | `packages/mobile-preview/runtime/host/components/image.js` | `MPC-01`, `MPA-09` | `bun test packages/mobile-preview/runtime/__tests__/image.test.ts` |
| `MPC-04` | Map single-line `TextInput` | `packages/mobile-preview/runtime/host/components/text-input-singleline.js` | `MPC-01`, `MPB-08` | `bun test packages/mobile-preview/runtime/__tests__/text-input-singleline.test.ts` |
| `MPC-05` | Map multiline `TextInput` | `packages/mobile-preview/runtime/host/components/text-input-multiline.js` | `MPC-01`, `MPB-08` | `bun test packages/mobile-preview/runtime/__tests__/text-input-multiline.test.ts` |
| `MPC-06` | Map `Switch` | `packages/mobile-preview/runtime/host/components/switch.js` | `MPC-01`, `MPB-06` | `bun test packages/mobile-preview/runtime/__tests__/switch.test.ts` |
| `MPC-07` | Map `ActivityIndicator` | `packages/mobile-preview/runtime/host/components/activity-indicator.js` | `MPC-01` | `bun test packages/mobile-preview/runtime/__tests__/activity-indicator.test.ts` |
| `MPC-08` | Implement `FlatList` over non-virtualized `ScrollView` | `packages/mobile-preview/runtime/shims/core/flat-list.js` | `MPC-02` | `bun test apps/web/client/src/services/mobile-preview/__tests__/flat-list.test.ts` |
| `MPC-09` | Implement `SectionList` over non-virtualized `ScrollView` | `packages/mobile-preview/runtime/shims/core/section-list.js` | `MPC-02` | `bun test apps/web/client/src/services/mobile-preview/__tests__/section-list.test.ts` |
| `MPC-10` | Add `Modal` surface manager and second root support | `packages/mobile-preview/runtime/host/modal-surface.js`, `packages/mobile-preview/runtime/bootstrap/app-registry.js` | `MPC-01` | `bun test packages/mobile-preview/runtime/__tests__/modal-surface.test.ts` |
| `MPC-E1` | E2E: forms and controls render and update | `apps/web/client/e2e/mobile-preview/components/forms.spec.ts` | `MP0-08`, `MPC-04`, `MPC-05`, `MPC-06`, `MPC-07` | `bunx playwright test apps/web/client/e2e/mobile-preview/components/forms.spec.ts` |
| `MPC-E2` | E2E: images and lists render correctly | `apps/web/client/e2e/mobile-preview/components/images-and-lists.spec.ts` | `MP0-08`, `MPC-02`, `MPC-03`, `MPC-08`, `MPC-09` | `bunx playwright test apps/web/client/e2e/mobile-preview/components/images-and-lists.spec.ts` |
| `MPC-E3` | E2E: modal opens on separate surface | `apps/web/client/e2e/mobile-preview/components/modal.spec.ts` | `MP0-08`, `MPC-10` | `bunx playwright test apps/web/client/e2e/mobile-preview/components/modal.spec.ts` |

**Wave C merge gate:** `MPC-E1` through `MPC-E3` pass together.

## Wave D — Style Coverage

Style work should stay in dedicated helpers under `packages/mobile-preview/runtime/host/styles/`.

| ID | Title | Files | Depends | Validate |
|---|---|---|---|---|
| `MPD-01` | Add style resolver registry | `packages/mobile-preview/runtime/host/styles/index.js` | `MP0-05`, `MPA-02` | `bun test packages/mobile-preview/runtime/__tests__/styles-index.test.ts` |
| `MPD-02` | Resolve percentage dimensions against parent layout | `packages/mobile-preview/runtime/host/styles/percentage.js` | `MPD-01` | `bun test packages/mobile-preview/runtime/__tests__/style-percentage.test.ts` |
| `MPD-03` | Build transform matrix support | `packages/mobile-preview/runtime/host/styles/transform.js` | `MPD-01` | `bun test packages/mobile-preview/runtime/__tests__/style-transform.test.ts` |
| `MPD-04` | Add iOS shadow props passthrough | `packages/mobile-preview/runtime/host/styles/shadow.js` | `MPD-01` | `bun test packages/mobile-preview/runtime/__tests__/style-shadow.test.ts` |
| `MPD-05` | Add elevation behavior and Android no-op policy | `packages/mobile-preview/runtime/host/styles/elevation.js` | `MPD-01` | `bun test packages/mobile-preview/runtime/__tests__/style-elevation.test.ts` |
| `MPD-06` | Add typography extras | `packages/mobile-preview/runtime/host/styles/typography.js` | `MPD-01` | `bun test packages/mobile-preview/runtime/__tests__/style-typography.test.ts` |
| `MPD-07` | Add border styles and per-side border support | `packages/mobile-preview/runtime/host/styles/border.js` | `MPD-01` | `bun test packages/mobile-preview/runtime/__tests__/style-border.test.ts` |
| `MPD-08` | Add opacity, overflow, and z-index support | `packages/mobile-preview/runtime/host/styles/layering.js` | `MPD-01` | `bun test packages/mobile-preview/runtime/__tests__/style-layering.test.ts` |
| `MPD-E1` | E2E: transforms, percentages, and layering | `apps/web/client/e2e/mobile-preview/styles/layouts.spec.ts` | `MP0-08`, `MPD-02`, `MPD-03`, `MPD-08` | `bunx playwright test apps/web/client/e2e/mobile-preview/styles/layouts.spec.ts` |
| `MPD-E2` | E2E: shadows, borders, and typography | `apps/web/client/e2e/mobile-preview/styles/visuals.spec.ts` | `MP0-08`, `MPD-04`, `MPD-05`, `MPD-06`, `MPD-07` | `bunx playwright test apps/web/client/e2e/mobile-preview/styles/visuals.spec.ts` |

**Wave D merge gate:** `MPD-E1` and `MPD-E2` pass together.

## Wave E — Expo SDK Packages

Wave E is split into a scaffold plus domain groups. The scaffold must land first so package tasks do not share registry files.

| ID | Title | Files | Depends | Validate |
|---|---|---|---|---|
| `MPE-00` | Add Expo package shim auto-discovery | `packages/mobile-preview/runtime/shims/expo/index.js`, `packages/mobile-preview/runtime/registry.js` | `MPA-01`, `MPA-08` | `bun test packages/mobile-preview/runtime/__tests__/expo-registry.test.ts` |
| `MPE-01` | Device metadata group: `expo-constants`, `expo-device`, `expo-network`, `expo-battery` | `packages/mobile-preview/runtime/shims/expo/device-metadata.js` | `MPE-00` | `bun test apps/web/client/src/services/mobile-preview/__tests__/expo-device-metadata.test.ts` |
| `MPE-02` | Linking and system no-op group: `expo-linking`, `expo-system-ui`, `expo-splash-screen` | `packages/mobile-preview/runtime/shims/expo/linking-system.js` | `MPE-00` | `bun test apps/web/client/src/services/mobile-preview/__tests__/expo-linking-system.test.ts` |
| `MPE-03` | Browser utility group: `expo-web-browser`, `expo-clipboard`, `expo-haptics` | `packages/mobile-preview/runtime/shims/expo/browser-utils.js` | `MPE-00`, `MPA-08` | `bun test apps/web/client/src/services/mobile-preview/__tests__/expo-browser-utils.test.ts` |
| `MPE-04` | Font group: `expo-font` | `packages/mobile-preview/runtime/shims/expo/expo-font.js` | `MPE-00` | `bun test apps/web/client/src/services/mobile-preview/__tests__/expo-font.test.ts` |
| `MPE-05` | Camera and image picker group | `packages/mobile-preview/runtime/shims/expo/media-capture.js` | `MPE-00`, `MPA-08`, `MPC-03` | `bun test apps/web/client/src/services/mobile-preview/__tests__/expo-media-capture.test.ts` |
| `MPE-06` | Location and sensors group | `packages/mobile-preview/runtime/shims/expo/location-sensors.js` | `MPE-00`, `MPA-08` | `bun test apps/web/client/src/services/mobile-preview/__tests__/expo-location-sensors.test.ts` |
| `MPE-07` | File system group | `packages/mobile-preview/runtime/shims/expo/expo-file-system.js` | `MPE-00`, `MPA-08` | `bun test apps/web/client/src/services/mobile-preview/__tests__/expo-file-system.test.ts` |
| `MPE-08` | Secure storage group | `packages/mobile-preview/runtime/shims/expo/expo-secure-store.js` | `MPE-00`, `MPA-08` | `bun test apps/web/client/src/services/mobile-preview/__tests__/expo-secure-store.test.ts` |
| `MPE-09` | Notifications group | `packages/mobile-preview/runtime/shims/expo/expo-notifications.js` | `MPE-00`, `MPA-08` | `bun test apps/web/client/src/services/mobile-preview/__tests__/expo-notifications.test.ts` |
| `MPE-10` | Audio and video group | `packages/mobile-preview/runtime/shims/expo/expo-av.js` | `MPE-00`, `MPA-08`, `MPC-03` | `bun test apps/web/client/src/services/mobile-preview/__tests__/expo-av.test.ts` |
| `MPE-11` | Contacts and calendar group | `packages/mobile-preview/runtime/shims/expo/productivity.js` | `MPE-00`, `MPA-08` | `bun test apps/web/client/src/services/mobile-preview/__tests__/expo-productivity.test.ts` |
| `MPE-12` | Local auth group | `packages/mobile-preview/runtime/shims/expo/expo-local-authentication.js` | `MPE-00`, `MPA-08` | `bun test apps/web/client/src/services/mobile-preview/__tests__/expo-local-authentication.test.ts` |
| `MPE-13` | `expo-image` support | `packages/mobile-preview/runtime/shims/expo/expo-image.js` | `MPE-00`, `MPC-03` | `bun test apps/web/client/src/services/mobile-preview/__tests__/expo-image.test.ts` |
| `MPE-E1` | E2E: metadata, linking, and utility packages | `apps/web/client/e2e/mobile-preview/expo-sdk/utilities.spec.ts` | `MP0-08`, `MPE-01`, `MPE-02`, `MPE-03`, `MPE-04` | `bunx playwright test apps/web/client/e2e/mobile-preview/expo-sdk/utilities.spec.ts` |
| `MPE-E2` | E2E: media packages | `apps/web/client/e2e/mobile-preview/expo-sdk/media.spec.ts` | `MP0-08`, `MPE-05`, `MPE-10`, `MPE-13` | `bunx playwright test apps/web/client/e2e/mobile-preview/expo-sdk/media.spec.ts` |
| `MPE-E3` | E2E: device services packages | `apps/web/client/e2e/mobile-preview/expo-sdk/device-services.spec.ts` | `MP0-08`, `MPE-06`, `MPE-07`, `MPE-08`, `MPE-12` | `bunx playwright test apps/web/client/e2e/mobile-preview/expo-sdk/device-services.spec.ts` |
| `MPE-E4` | E2E: notifications, contacts, and calendar packages | `apps/web/client/e2e/mobile-preview/expo-sdk/productivity.spec.ts` | `MP0-08`, `MPE-09`, `MPE-11` | `bunx playwright test apps/web/client/e2e/mobile-preview/expo-sdk/productivity.spec.ts` |

**Wave E merge gate:** `MPE-E1` through `MPE-E4` pass together.

## Wave F — Third-Party UI Libraries

Wave F uses a separate `third-party` shim folder so vendor tasks can stay isolated.

| ID | Title | Files | Depends | Validate |
|---|---|---|---|---|
| `MPF-00` | Add third-party shim auto-discovery | `packages/mobile-preview/runtime/shims/third-party/index.js`, `packages/mobile-preview/runtime/registry.js` | `MPA-01` | `bun test packages/mobile-preview/runtime/__tests__/third-party-registry.test.ts` |
| `MPF-01` | `react-native-screens` pass-through shim | `packages/mobile-preview/runtime/shims/third-party/react-native-screens.js` | `MPF-00` | `bun test apps/web/client/src/services/mobile-preview/__tests__/react-native-screens.test.ts` |
| `MPF-02` | Gesture handler root view shim | `packages/mobile-preview/runtime/shims/third-party/react-native-gesture-handler-root.js` | `MPF-00`, `MPB-06` | `bun test apps/web/client/src/services/mobile-preview/__tests__/gesture-handler-root.test.ts` |
| `MPF-03` | Gesture recognizer event mapping | `packages/mobile-preview/runtime/shims/third-party/react-native-gesture-handler-events.js` | `MPF-00`, `MPB-06`, `MPB-09` | `bun test apps/web/client/src/services/mobile-preview/__tests__/gesture-handler-events.test.ts` |
| `MPF-04` | Vector icon base renderer and font fallback | `packages/mobile-preview/runtime/shims/third-party/vector-icons-base.js` | `MPF-00`, `MPE-04` | `bun test apps/web/client/src/services/mobile-preview/__tests__/vector-icons-base.test.ts` |
| `MPF-05` | Vector icon families batch A | `packages/mobile-preview/runtime/shims/third-party/vector-icons-batch-a.js` | `MPF-04` | `bun test apps/web/client/src/services/mobile-preview/__tests__/vector-icons-batch-a.test.ts` |
| `MPF-06` | Vector icon families batch B | `packages/mobile-preview/runtime/shims/third-party/vector-icons-batch-b.js` | `MPF-04` | `bun test apps/web/client/src/services/mobile-preview/__tests__/vector-icons-batch-b.test.ts` |
| `MPF-07` | `react-native-svg` core primitives | `packages/mobile-preview/runtime/shims/third-party/react-native-svg-core.js` | `MPF-00` | `bun test apps/web/client/src/services/mobile-preview/__tests__/react-native-svg-core.test.ts` |
| `MPF-08` | `react-native-svg` shape primitives | `packages/mobile-preview/runtime/shims/third-party/react-native-svg-shapes.js` | `MPF-07` | `bun test apps/web/client/src/services/mobile-preview/__tests__/react-native-svg-shapes.test.ts` |
| `MPF-09` | Reanimated static stub | `packages/mobile-preview/runtime/shims/third-party/react-native-reanimated.js` | `MPF-00` | `bun test apps/web/client/src/services/mobile-preview/__tests__/reanimated.test.ts` |
| `MPF-10` | Navigation container and stack shim | `packages/mobile-preview/runtime/shims/third-party/react-navigation-stack.js` | `MPF-00`, `MPB-06` | `bun test apps/web/client/src/services/mobile-preview/__tests__/react-navigation-stack.test.ts` |
| `MPF-11` | Bottom tabs shim and Nativewind compatibility pass | `packages/mobile-preview/runtime/shims/third-party/react-navigation-tabs-nativewind.js` | `MPF-00`, `MPF-10` | `bun test apps/web/client/src/services/mobile-preview/__tests__/react-navigation-tabs-nativewind.test.ts` |
| `MPF-E1` | E2E: tabs-template level navigation flow | `apps/web/client/e2e/mobile-preview/third-party/tabs-template.spec.ts` | `MP0-08`, `MPF-01`, `MPF-02`, `MPF-04`, `MPF-10`, `MPF-11` | `bunx playwright test apps/web/client/e2e/mobile-preview/third-party/tabs-template.spec.ts` |
| `MPF-E2` | E2E: SVG and icon rendering | `apps/web/client/e2e/mobile-preview/third-party/svg-and-icons.spec.ts` | `MP0-08`, `MPF-05`, `MPF-06`, `MPF-07`, `MPF-08` | `bunx playwright test apps/web/client/e2e/mobile-preview/third-party/svg-and-icons.spec.ts` |
| `MPF-E3` | E2E: gesture-handler and reanimated compatibility | `apps/web/client/e2e/mobile-preview/third-party/gestures.spec.ts` | `MP0-08`, `MPF-03`, `MPF-09` | `bunx playwright test apps/web/client/e2e/mobile-preview/third-party/gestures.spec.ts` |

**Wave F merge gate:** `MPF-E1` through `MPF-E3` pass together.

## Wave G — Hardening & Polish

Wave G closes the loop: connection resilience, editor visibility, source maps, budgets, unsupported imports, and golden regressions.

| ID | Title | Files | Depends | Validate |
|---|---|---|---|---|
| `MPG-01` | Add WebSocket reconnect manager with exponential backoff | `packages/mobile-preview/runtime/bootstrap/ws-reconnect.js` | `MP0-06`, `MPA-12` | `bun test packages/mobile-preview/runtime/__tests__/ws-reconnect.test.ts` |
| `MPG-02` | Add runtime keepalive and dead-connection detection | `packages/mobile-preview/runtime/bootstrap/keepalive.js` | `MP0-06`, `MPG-01` | `bun test packages/mobile-preview/runtime/__tests__/keepalive.test.ts` |
| `MPG-03` | Add server-side ping and stale-client pruning | `packages/mobile-preview/server/relay.ts`, `packages/mobile-preview/server/status.ts` | `MP0-07`, `MPG-02` | `bun test packages/mobile-preview/server/__tests__/relay-heartbeat.test.ts` |
| `MPG-04` | Add editor connection status hook | `apps/web/client/src/hooks/use-mobile-preview-connection.ts` | `MPG-03` | `bun test apps/web/client/src/hooks/__tests__/use-mobile-preview-connection.test.tsx` |
| `MPG-05` | Add connection status indicator UI | `apps/web/client/src/app/project/[id]/_components/top-bar/preview-on-device-button.tsx` | `MPG-04` | `bun test 'apps/web/client/src/app/project/[id]/_components/top-bar/__tests__/preview-on-device-button.test.tsx'` |
| `MPG-06` | Add push error store and panel model | `apps/web/client/src/services/mobile-preview/error-store.ts`, `apps/web/client/src/hooks/use-mobile-preview-status.tsx` | `MPA-12` | `bun test apps/web/client/src/services/mobile-preview/__tests__/error-store.test.ts` |
| `MPG-07` | Add push error panel UI with file links | `apps/web/client/src/components/ui/mobile-preview-error-panel.tsx` | `MPG-06` | `bun test apps/web/client/src/components/ui/__tests__/mobile-preview-error-panel.test.tsx` |
| `MPG-08` | Emit source maps from the mobile preview bundler | `apps/web/client/src/services/mobile-preview/bundler/source-map.ts`, `apps/web/client/src/services/mobile-preview/bundler/module-code.ts` | `MP0-04` | `bun test apps/web/client/src/services/mobile-preview/__tests__/source-map.test.ts` |
| `MPG-09` | Decode source maps in editor error surfacing | `apps/web/client/src/services/mobile-preview/error-mapper.ts`, `apps/web/client/src/services/mobile-preview/error-store.ts` | `MPG-06`, `MPG-08` | `bun test apps/web/client/src/services/mobile-preview/__tests__/error-mapper.test.ts` |
| `MPG-10` | Add bundle size budget warnings and hard-fail threshold | `apps/web/client/src/services/mobile-preview/bundler/budget.ts`, `apps/web/client/src/services/mobile-preview/index.ts` | `MP0-04` | `bun test apps/web/client/src/services/mobile-preview/__tests__/budget.test.ts` |
| `MPG-11` | Add unsupported-import preflight | `apps/web/client/src/services/mobile-preview/bundler/preflight.ts` | `MP0-04`, `MPA-07` | `bun test apps/web/client/src/services/mobile-preview/__tests__/preflight.test.ts` |
| `MPG-12` | Add golden fixture registry for regressions | `apps/web/client/e2e/mobile-preview/helpers/golden-fixtures.ts` | `MP0-03`, `MP0-08` | `bun test apps/web/client/e2e/mobile-preview/helpers/golden-fixtures.ts` |
| `MPG-E1` | E2E: reconnect after preview server bounce | `apps/web/client/e2e/mobile-preview/hardening/reconnect.spec.ts` | `MP0-08`, `MPG-01`, `MPG-02`, `MPG-03` | `bunx playwright test apps/web/client/e2e/mobile-preview/hardening/reconnect.spec.ts` |
| `MPG-E2` | E2E: errors map back to original file and line | `apps/web/client/e2e/mobile-preview/hardening/source-maps.spec.ts` | `MP0-08`, `MPG-07`, `MPG-08`, `MPG-09` | `bunx playwright test apps/web/client/e2e/mobile-preview/hardening/source-maps.spec.ts` |
| `MPG-E3` | E2E: bundle budget and unsupported import failures are explicit | `apps/web/client/e2e/mobile-preview/hardening/preflight.spec.ts` | `MP0-08`, `MPG-10`, `MPG-11` | `bunx playwright test apps/web/client/e2e/mobile-preview/hardening/preflight.spec.ts` |
| `MPG-E4` | E2E: golden fixtures stay green | `apps/web/client/e2e/mobile-preview/hardening/golden-fixtures.spec.ts` | `MP0-08`, `MPG-12`, `MPB-E1`, `MPC-E1`, `MPD-E1`, `MPE-E1`, `MPF-E1` | `bunx playwright test apps/web/client/e2e/mobile-preview/hardening/golden-fixtures.spec.ts` |

**Wave G merge gate:** `MPG-E1` through `MPG-E4` pass together.

## Suggested worker-pool order

### Phase 0

Run `MP0-01` and `MP0-02` first. They unlock every other agent.

### Phase 1

Keep one coordinator on Wave A hot spots:

- `MPA-01`
- `MPA-07`
- `MPA-10`
- `MPA-12`

Fill the rest of the pool with the isolated shim tasks.

### Phase 2

Once Wave A is stable:

- 3 agents on Wave B
- 3 agents on Wave C
- 2 agents on Wave D

### Phase 3

After `MPE-00` and `MPF-00`, fill all 8 slots with package and library tasks. This is the longest tail and where parallelism pays off.

### Phase 4

Wave G should overlap the end of E and F, but keep `MPG-E4` for last because it is the full-system regression gate.

## Merge policy

After a task passes:

```bash
git checkout feat/mobile-preview-shim
git merge --no-ff ai/<task-id>-<slug>
bun run typecheck
```

Then run the task-level validate command again on the integration branch. If the task belongs to a completed wave, run the whole wave gate before accepting more merges from the next wave.

## Done criteria for the queue

The queue is complete when:

- Wave A through Wave G merge gates all pass on `feat/mobile-preview-shim`.
- The mobile-preview E2E suite can run from any worktree slot without port conflicts.
- There are no remaining tasks that require editing a hotspot file shared by another open task.
- `plans/mobile-preview-shim-implementation.md` Workstreams A through G are covered by landed tasks.
