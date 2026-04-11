# Onlook Mobile Client — parallel task queue

**Source plan:** `plans/onlook-mobile-client-plan.md` (canonical "what and why"). Every task in this file references a section of the source plan.
**Parent conventions:** worktree layout, branch naming, per-worktree dep install, scope guards, retry policy, dead-letter rules — all inherited from `plans/expo-browser-task-queue.md`. Read its "Conventions" section before dispatching agents from this file. This file documents only the **deltas** specific to the mobile client.

**Goal:** a long queue of small, file-scoped tasks that can be pulled by up to **8 parallel agents** working in isolated git worktrees, each gated by a runnable test that returns 0/non-0. The full DAG lands Phases 1–6 of the source plan plus a cross-cutting integration wave.

**Decomposition principles (inherited, re-asserted because they matter on a native codebase):**

- **One file, one owner.** No two tasks in the same wave touch the same file. Hotspot files (Xcode `project.pbxproj`, `Podfile`, `build.gradle`, `Info.plist`, `AndroidManifest.xml`, `manifest-builder.ts`) are resolved by a single up-front "pre-populate stubs" task in Phase F — downstream waves then only edit their own Swift/Kotlin/TS files.
- **Single-file or 2–3-file tasks only.** Augment Code's measurement: single-file tasks land ~87% first-pass; multi-file tasks drop to ~19%. Native work bias-toward-single-file even harder than web work because every Xcode-project edit is a merge conflict waiting to happen.
- **Interface-first.** Phase F lands all shared types, protocol schemas, runtime version constants, and the e2e harness sequentially with one agent. Phases 1–6 only start after Phase F is fully merged to `feat/mobile-client`.
- **Each task has an explicit `validate` command** that exits 0 on pass. Agents retry 3 times with test output as feedback, then dead-letter.
- **Physical-device tasks are dead-letter by default.** Anything that genuinely requires a real iPhone (Hermes SDK-drift validation, on-device inspector tap latency, TestFlight distribution proof) is marked **`device-only`** and waits for a human to walk the scenario. The simulator/emulator path covers ~90% of the work.

---

## Conventions (delta from parent queue)

### Base branch

All worktrees branch from **`feat/mobile-client`** (new long-running integration branch), not `main`. Pattern:

```bash
git worktree add -b ai/<task-id>-<slug> .trees/<task-id>-<slug> feat/mobile-client
```

`feat/mobile-client` is cut from `main` as the very first step (task `MCF0`). It remains the long-running staging branch until Wave I (integration) proves the full DoD from the source plan, then merges to `main` as one PR with a binary ready for TestFlight upload.

### E2E framework — Maestro (not Chrome MCP, not Playwright)

Per the source plan's "no stock Expo Go, no Mac required for the user" DoD, validation of the mobile client cannot piggyback on the existing browser-MCP harness. The validation stack is:

| Layer | Scope | Tooling |
|---|---|---|
| **L1 — type + unit** | Every task | `bun run typecheck && bun test <task-tests>` |
| **L2 — simulator/emulator E2E** | Any task that produces runnable iOS/Android code | `bun run mobile:e2e:ios -- <flow>` or `bun run mobile:e2e:android -- <flow>` (Maestro CLI against iOS Simulator / Android Emulator) |
| **L3 — orchestrator state check** | Every task whose validate is L2 | `jq -e '.flows["<flow-id>"].state == "passed"' apps/mobile-client/verification/results.json` |
| **L4 — device-only manual walk** | Tasks explicitly marked `device-only` | Human runs the flow on a physical iPhone, updates `results.json` by hand. Dead-letter until marked passed. |

**Maestro flow specs** live at `apps/mobile-client/e2e/flows/<NN>-<slug>.yaml`. Each flow has a sibling markdown spec (`<NN>-<slug>.md`) that records pre-conditions, expected assertions, and screenshot paths. `results.json` is the single source of truth the orchestrator jq-checks.

Why Maestro:
- YAML flow files are readable and agent-authorable
- Cross-platform (same flow runs on iOS Simulator + Android Emulator)
- Headless CLI, no manual driver like Appium
- Matches the "runnable test as the unambiguous gate" model from the parent queue

**Framework pin is a Phase F decision.** `MCF9` lands the Maestro harness scaffold. If the orchestrator later discovers Maestro can't express something (e.g., three-finger long-press for the dev menu), that task gets a `device-only` marker and dead-letters.

### Per-worktree scope guard

Same pattern as the parent queue. Drop this into `.trees/<task-id>-<slug>/.claude/rules.md` before the agent starts:

```markdown
# Task scope for <task-id>

Work ONLY on the files listed below. Do NOT modify any other file in the repo.
If you need to touch a file outside this list, STOP and report — that's
a sign the task needs to be split.

Files:
- <file-1>
- <file-2>

Specific to apps/mobile-client:
- DO NOT edit ios/OnlookMobile.xcodeproj/project.pbxproj — that is owned by MCF8.
  Your Swift/ObjC files were pre-registered there. If you need to register a
  NEW file, STOP and dead-letter.
- DO NOT edit android/app/build.gradle or AndroidManifest.xml — same rule, MCF8.
- DO NOT add dependencies to apps/mobile-client/package.json — same rule, MCF1.
- Type safety: no `any`, no `as unknown as`. Source plan CLAUDE.md rule.
```

### Per-worktree native build cache

Native builds are slow. Each worktree has its own `ios/Pods/`, `ios/build/`, and `android/build/` — but the underlying Xcode DerivedData cache and Gradle cache are shared at the user level. Do **not** symlink `Pods/` between worktrees; the Podfile.lock can diverge. For Gradle, set `GRADLE_USER_HOME=~/.gradle-shared` so the distribution and dep cache are shared without the lock file conflict.

First `bun install && cd ios && pod install` in a new mobile-client worktree takes ~3 min cold. Subsequent worktrees take ~45s because CocoaPods hits the shared cache. Budget accordingly.

### Port isolation

Each agent's dev server and Metro bundler bind to a unique port. Convention: `METRO_PORT=$((8081 + <agent-index>))`, `RELAY_PORT=$((8787 + <agent-index>))`. The orchestrator assigns indexes 0–7. Tasks that spin a local relay for testing read `$RELAY_PORT` instead of hardcoding 8787.

### Merge strategy

After validate passes, orchestrator merges to `feat/mobile-client` in **dependency order**. Never merge out of order — a later-DAG task can hold up earlier merges if it landed sooner, but it cannot skip the queue.

```bash
git checkout feat/mobile-client
git merge --no-ff ai/<task-id>-<slug>
bun run typecheck && bun test           # integration check at integration branch
git worktree remove .trees/<task-id>-<slug>
git branch -d ai/<task-id>-<slug>
```

If integration check fails after merge: **revert the merge**, dead-letter the task, continue.

### Concurrency cap

Hard cap of **8 concurrent agents**. Waves below with more than 8 tasks are saturation-safe — the orchestrator pulls from the pending pool as soon as an agent frees up.

---

## Hotspot file registry

These files are touched by many conceptually-independent pieces of work. Each is assigned to **exactly one task** that owns ALL anticipated edits up front. Downstream waves add their own Swift/Kotlin/TS files but never edit these hotspots.

| Hotspot file | Owner task | Strategy |
|---|---|---|
| `apps/mobile-client/package.json` | **MCF1** | Owner adds every anticipated dep up front (`react-native@0.81.x`, `expo`, `expo-camera`, `expo-secure-store`, `expo-haptics`, `@onlook/mobile-client-protocol`, Maestro, etc.). No downstream task touches this file. |
| `apps/mobile-client/ios/OnlookMobile.xcodeproj/project.pbxproj` | **MCF8** | Owner runs `expo prebuild` once, then pre-registers every anticipated `.swift`/`.mm`/`.h` file as an empty stub and commits the populated pbxproj. Downstream tasks only edit the contents of those stub files. |
| `apps/mobile-client/ios/Podfile` + `Podfile.lock` | **MCF8** | Owner adds all pod references up front. No downstream task touches Podfile. |
| `apps/mobile-client/ios/OnlookMobile/Info.plist` | **MCF8** | Owner adds all required keys: camera permission, URL types for `onlook://` scheme, `NSAppTransportSecurity` for local relay, etc. |
| `apps/mobile-client/android/app/build.gradle` | **MCF8** | Owner adds all anticipated deps + NDK config for JSI/C++ up front. |
| `apps/mobile-client/android/app/src/main/AndroidManifest.xml` | **MCF8** | Owner adds camera permission, deep-link intent filter, `usesCleartextTraffic` for local relay. |
| `packages/mobile-client-protocol/src/index.ts` | **MCF2** | Owner creates the re-export index with every anticipated named export. Downstream F3–F7 tasks fill in the per-type files; index.ts never changes again. |
| `apps/cf-expo-relay/src/manifest-builder.ts` | **MC6.2** | Owner adds the `extra.expoClient.onlookRuntimeVersion` field. Only one mobile-client wave task touches the relay, and it's this one. |
| `packages/browser-metro/src/host/index.ts` | **MC4.12** | Owner adds the `target: 'expo-go' | 'onlook-client'` flag + jsx-source hook wiring. |
| `apps/web/client/src/components/.../qr-modal/payload.ts` | **MC3.19** | Owner updates the editor-side QR payload to emit `onlook://` alongside `exp://`. Single editor-side touchpoint. |

Any task that feels like it needs to edit a hotspot outside this table must STOP and escalate. That's the signal the decomposition missed something.

---

## Wave structure (the full DAG, top-down)

```
MCF0 (cut feat/mobile-client)
  ↓
Phase F — foundation (serial, 1 agent)          MCF1 → MCF13
  ↓
Wave 1 — native shell (parallel)                MC1.1 … MC1.12     (12 tasks)
  ↓
Wave 2 — runtime + JSI (parallel)               MC2.1 … MC2.15     (15 tasks)
  ↓
Wave 3 — relay client + QR (parallel)           MC3.1 … MC3.22     (22 tasks)
  ↓
Wave 4 — OnlookInspector (parallel)             MC4.1 … MC4.19     (19 tasks)
  ↓
Wave 5 — debug surface (parallel)               MC5.1 … MC5.18     (18 tasks)
  ↓
Wave 6 — distribution (mostly parallel)         MC6.1 … MC6.9      (9 tasks)
  ↓
Wave I — integration + DoD verification         MCI.1 … MCI.6      (6 tasks)
```

Total: **~116 tasks**. Waves 3, 4, and 5 are the fattest and give the 8-agent pool its longest saturation runs.

---

## Phase F — Foundation (serial; 1 agent)

Phase F is explicitly serial. Every task in here either creates a hotspot file or defines an interface that Waves 1–6 consume. Running F tasks in parallel will corrupt the Xcode project, the package.json, or the shared protocol package — so the orchestrator pins Phase F to a single agent that walks F0 → F13 in order.

- **MCF0** — Cut `feat/mobile-client` long-running branch
  - Files: branch metadata only
  - Deps: —
  - Validate: `git rev-parse --verify feat/mobile-client && git diff main feat/mobile-client | wc -l` returns `0`

- **MCF1** — `apps/mobile-client/package.json` + workspace wiring
  - Files: `apps/mobile-client/package.json`, root `package.json` (workspaces array), `tsconfig.base.json` reference
  - Deps: MCF0
  - Validate: `cd apps/mobile-client && bun install && bun run typecheck` (empty src is fine, just wires the workspace)
  - Note: Adds every anticipated dep up front. See hotspot registry.

- **MCF2** — `packages/mobile-client-protocol/` package scaffold + `src/index.ts`
  - Files: `packages/mobile-client-protocol/package.json`, `packages/mobile-client-protocol/tsconfig.json`, `packages/mobile-client-protocol/src/index.ts`
  - Deps: MCF1
  - Validate: `bun run typecheck` (index.ts re-exports every type even though the files are stubs — re-exports will compile once MCF3–F7 fill the stubs)

- **MCF3** — Bundle envelope types
  - Files: `packages/mobile-client-protocol/src/bundle-envelope.ts`
  - Deps: MCF2
  - Validate: `bun test packages/mobile-client-protocol/src/bundle-envelope.test.ts` (type-level test: Zod schema round-trips a fixture)

- **MCF4** — Relay manifest Zod schema
  - Files: `packages/mobile-client-protocol/src/manifest.ts`
  - Deps: MCF2
  - Validate: `bun test packages/mobile-client-protocol/src/manifest.test.ts` (parses fixture captured from the current `apps/cf-expo-relay` production response)

- **MCF5** — WebSocket message union (`bundleUpdate`, `onlook:select`, `onlook:console`, `onlook:network`, `onlook:error`)
  - Files: `packages/mobile-client-protocol/src/ws-messages.ts`
  - Deps: MCF2
  - Validate: `bun test packages/mobile-client-protocol/src/ws-messages.test.ts` (discriminated union exhaustiveness)

- **MCF6** — Inspector descriptor types (`ReactNodeDescriptor`, `TapResult`, `SourceLocation`)
  - Files: `packages/mobile-client-protocol/src/inspector.ts`
  - Deps: MCF2
  - Validate: `bun test packages/mobile-client-protocol/src/inspector.test.ts`

- **MCF7** — Runtime version constant + semver compatibility matrix
  - Files: `packages/mobile-client-protocol/src/runtime-version.ts`
  - Deps: MCF2
  - Validate: `bun test packages/mobile-client-protocol/src/runtime-version.test.ts` (compatibility matrix: `0.1.0` client accepts `0.1.x` bundles, rejects `0.2.0`)

- **MCF8** — `expo prebuild` + commit iOS/Android projects with stub file pre-registration
  - Files: ENTIRE `apps/mobile-client/ios/**`, ENTIRE `apps/mobile-client/android/**`
  - Deps: MCF1
  - Validate: `cd apps/mobile-client && cd ios && pod install && xcodebuild -workspace OnlookMobile.xcworkspace -scheme OnlookMobile -configuration Debug -sdk iphonesimulator build | tail -20` exits 0 AND `cd ../android && ./gradlew assembleDebug` exits 0
  - Note: This is the single biggest Phase F task. It creates empty stub files for every Swift/ObjC/C++/Kotlin file Waves 1–5 will populate, and registers them in `project.pbxproj` / `build.gradle` up front.

- **MCF9** — Maestro e2e harness scaffold
  - Files: `apps/mobile-client/e2e/maestro.config.yaml`, `apps/mobile-client/e2e/flows/00-smoke.yaml`, `apps/mobile-client/verification/results.json` (with empty `flows: {}`)
  - Deps: MCF8
  - Validate: `bun run mobile:e2e:ios -- 00-smoke.yaml` (empty flow that just launches the app and takes a screenshot)

- **MCF10** — CI workflow for mobile client
  - Files: `.github/workflows/mobile-client.yml`
  - Deps: MCF8, MCF9
  - Validate: `act -W .github/workflows/mobile-client.yml -j build-ios --dryrun` (or `gh workflow view mobile-client.yml --yaml` if `act` unavailable)

- **MCF11** — Runtime asset wiring (bake `packages/mobile-preview/runtime/bundle.js` into the binary)
  - Files: `apps/mobile-client/ios/OnlookMobile/Resources/onlook-runtime.js` (symlink or build-step copy), `apps/mobile-client/android/app/src/main/assets/onlook-runtime.js`, `apps/mobile-client/scripts/bundle-runtime.ts`
  - Deps: MCF8
  - Validate: `bun run mobile:bundle-runtime && test -s apps/mobile-client/ios/OnlookMobile/Resources/onlook-runtime.js && test -s apps/mobile-client/android/app/src/main/assets/onlook-runtime.js`
  - Note: The 241KB runtime already exists at `packages/mobile-preview/runtime/bundle.js`. This task wires the build step to copy it in; it does NOT author a new runtime.

- **MCF12** — Scope guard template
  - Files: `apps/mobile-client/.claude/rules.template.md`
  - Deps: MCF1
  - Validate: `test -f apps/mobile-client/.claude/rules.template.md`

- **MCF13** — Per-task `validate` harness script
  - Files: `apps/mobile-client/scripts/validate-task.ts`
  - Deps: MCF9, MCF10
  - Validate: `bun run apps/mobile-client/scripts/validate-task.ts MCF0` exits 0 (smoke-check that the harness itself runs)

**Phase F exit criterion:** `feat/mobile-client` has a buildable iOS and Android scaffold that boots to a black screen, runs an empty Maestro smoke flow, and has the entire shared protocol package typechecking. All hotspot files are pre-populated. Waves 1–6 can now run in parallel.

---

## Wave 1 — Native shell scaffold (parallel; source plan Phase 1)

Goal: buildable app that loads a Hermes JS context and prints `[onlook-runtime] hermes ready`.

- **MC1.1** — iOS `AppDelegate.swift` — app lifecycle + Hermes bootstrap
  - Files: `apps/mobile-client/ios/OnlookMobile/AppDelegate.swift`
  - Deps: MCF8, MCF11
  - Validate: `bun run mobile:build:ios && bun run mobile:e2e:ios -- 01-boot.yaml` (flow asserts device log contains `[onlook-runtime] hermes ready`)

- **MC1.2** — iOS `SceneDelegate.swift` — single-window setup
  - Files: `apps/mobile-client/ios/OnlookMobile/SceneDelegate.swift`
  - Deps: MCF8
  - Validate: `bun run mobile:build:ios` (builds; scene wiring is visual-only until MC3)

- **MC1.3** — iOS root view controller (hosts the Fabric root view)
  - Files: `apps/mobile-client/ios/OnlookMobile/OnlookRootViewController.swift`
  - Deps: MCF8
  - Validate: `bun run mobile:build:ios && bun run mobile:e2e:ios -- 02-black-screen.yaml`

- **MC1.4** — iOS Hermes init in AppDelegate (reads `onlook-runtime.js` asset and evals once)
  - Files: `apps/mobile-client/ios/OnlookMobile/HermesBootstrap.mm`
  - Deps: MCF11, MC1.1
  - Validate: `bun run mobile:e2e:ios -- 03-hermes-eval.yaml` (device log contains `[onlook-runtime] hermes ready`)

- **MC1.5** — Android `MainActivity.kt` — activity lifecycle + Hermes bootstrap
  - Files: `apps/mobile-client/android/app/src/main/java/com/onlook/mobile/MainActivity.kt`
  - Deps: MCF8, MCF11
  - Validate: `bun run mobile:build:android && bun run mobile:e2e:android -- 01-boot.yaml`

- **MC1.6** — Android `MainApplication.kt` — application bootstrap
  - Files: `apps/mobile-client/android/app/src/main/java/com/onlook/mobile/MainApplication.kt`
  - Deps: MCF8
  - Validate: `bun run mobile:build:android`

- **MC1.7** — Android Hermes init (JNI call that reads `onlook-runtime.js` asset)
  - Files: `apps/mobile-client/android/app/src/main/cpp/hermes_bootstrap.cpp`
  - Deps: MCF11, MC1.5
  - Validate: `bun run mobile:e2e:android -- 03-hermes-eval.yaml`

- **MC1.8** — Expo module allowlist enforcement
  - Files: `apps/mobile-client/react-native.config.js`
  - Deps: MCF8
  - Validate: `bun run mobile:build:ios` AND `cd apps/mobile-client/ios && grep -L ExpoFileSystem Pods/Pods.xcodeproj/project.pbxproj` (proves the disallowed module is NOT in the build)

- **MC1.9** — `SUPPORTED_MODULES.md` documentation
  - Files: `apps/mobile-client/SUPPORTED_MODULES.md`
  - Deps: MCF1
  - Validate: `test -f apps/mobile-client/SUPPORTED_MODULES.md && grep -q 'expo-camera' apps/mobile-client/SUPPORTED_MODULES.md`

- **MC1.10** — Logger module (`OnlookLogger.swift` + Kotlin equivalent) for `[onlook-runtime]` prefix
  - Files: `apps/mobile-client/ios/OnlookMobile/OnlookLogger.swift`, `apps/mobile-client/android/app/src/main/java/com/onlook/mobile/OnlookLogger.kt`
  - Deps: MCF8
  - Validate: `bun run mobile:build:ios && bun run mobile:build:android` (2-file task, same conceptual unit)

- **MC1.11** — CI job: iOS simulator build + 01/02/03 flow runs
  - Files: `.github/workflows/mobile-client.yml` (append only — MCF10 pre-reserved the job slot)
  - Deps: MCF10, MC1.4
  - Validate: `gh workflow run mobile-client.yml -f phase=wave1-ios` and `gh run watch --exit-status`
  - Note: MCF10 pre-created the `build-ios` job as an empty shell; this task fills it in.

- **MC1.12** — CI job: Android emulator build + flow runs
  - Files: `.github/workflows/mobile-client.yml` (append only — MCF10 pre-reserved the job slot)
  - Deps: MCF10, MC1.7
  - Validate: `gh workflow run mobile-client.yml -f phase=wave1-android` and `gh run watch --exit-status`

**Wave 1 exit criterion:** Both iOS and Android builds boot to a black screen, Hermes evals the runtime asset, and three Maestro flows (boot, black-screen, hermes-eval) pass on both platforms in CI.

---

## Wave 2 — `OnlookRuntime` JSI binding (parallel; source plan Phase 2)

Goal: replace Spike B's scraping path with a documented `global.OnlookRuntime.runApplication()` entry point.

- **MC2.1** — C++ JSI host object header
  - Files: `apps/mobile-client/cpp/OnlookRuntime.h`
  - Deps: MCF8
  - Validate: `bun run mobile:build:ios` (compiles as part of the iOS target)

- **MC2.2** — C++ JSI host object skeleton (empty method bodies)
  - Files: `apps/mobile-client/cpp/OnlookRuntime.cpp`
  - Deps: MC2.1
  - Validate: `bun run mobile:build:ios && bun run mobile:build:android`

- **MC2.3** — iOS installer `.mm` that registers `OnlookRuntime` on `global`
  - Files: `apps/mobile-client/ios/OnlookMobile/OnlookRuntimeInstaller.mm`
  - Deps: MC2.2, MC1.4
  - Validate: `bun run mobile:e2e:ios -- 04-global-present.yaml` (evaluates `typeof global.OnlookRuntime === 'object'` via a debug JSI call, asserts true)

- **MC2.4** — Android JNI installer that registers `OnlookRuntime` on `global`
  - Files: `apps/mobile-client/android/app/src/main/cpp/onlook_runtime_installer.cpp`
  - Deps: MC2.2, MC1.7
  - Validate: `bun run mobile:e2e:android -- 04-global-present.yaml`

- **MC2.5** — Native-side Fabric `registerEventHandler` pre-JS call (iOS)
  - Files: `apps/mobile-client/ios/OnlookMobile/FabricEventBootstrap.mm`
  - Deps: MC2.3
  - Validate: `bun run mobile:e2e:ios -- 05-fabric-event-registered.yaml`

- **MC2.6** — Native-side Fabric `registerEventHandler` pre-JS call (Android)
  - Files: `apps/mobile-client/android/app/src/main/cpp/fabric_event_bootstrap.cpp`
  - Deps: MC2.4
  - Validate: `bun run mobile:e2e:android -- 05-fabric-event-registered.yaml`

- **MC2.7** — `runApplication(bundleSource, props)` C++ impl (fresh Hermes context, eval, call `onlookMount`)
  - Files: `apps/mobile-client/cpp/OnlookRuntime_runApplication.cpp`
  - Deps: MC2.5, MC2.6, MCF3 (bundle envelope types)
  - Validate: `bun run mobile:e2e:ios -- 06-red-square.yaml` AND `bun run mobile:e2e:android -- 06-red-square.yaml` (Maestro takes screenshot, compares against `e2e/fixtures/red-square.png` via image-diff)

- **MC2.8** — `reloadBundle(bundleSource)` C++ impl (atomic tree teardown + remount)
  - Files: `apps/mobile-client/cpp/OnlookRuntime_reloadBundle.cpp`
  - Deps: MC2.7
  - Validate: `bun run mobile:e2e:ios -- 07-reload-bundle.yaml` (load red square, reload with blue square, assert screenshot matches blue-square fixture)

- **MC2.9** — `dispatchEvent(name, payload)` C++ impl
  - Files: `apps/mobile-client/cpp/OnlookRuntime_dispatchEvent.cpp`
  - Deps: MC2.7
  - Validate: `bun test apps/mobile-client/__tests__/OnlookRuntime_dispatchEvent.spec.ts` (a mock Maestro flow posts an event, JS-side listener returns via log)

- **MC2.10** — Runtime asset loader (reads baked `onlook-runtime.js` and evals into fresh Hermes context before user bundle)
  - Files: `apps/mobile-client/cpp/RuntimeAssetLoader.cpp`
  - Deps: MC2.3, MC2.4, MCF11
  - Validate: `bun run mobile:e2e:ios -- 08-runtime-evaled.yaml` (evaluates `typeof global.React === 'function'` before any user bundle)

- **MC2.11** — `iife-wrapper.ts` "no top-level export" unit test
  - Files: `packages/browser-metro/src/host/__tests__/iife-wrapper-no-export.test.ts`
  - Deps: MCF3
  - Validate: `bun test packages/browser-metro/src/host/__tests__/iife-wrapper-no-export.test.ts`
  - Note: Addresses the Hermes parser constraint from source-plan Phase 2. Pure additive test in an existing package.

- **MC2.12** — `OnlookRuntime.version` reports compiled binary version to JS
  - Files: `apps/mobile-client/cpp/OnlookRuntime_version.cpp`
  - Deps: MC2.3, MCF7
  - Validate: `bun run mobile:e2e:ios -- 09-version-reported.yaml`

- **MC2.13** — Public docs comment block on `OnlookRuntime.h` (API surface for Wave 3 consumers)
  - Files: `apps/mobile-client/cpp/OnlookRuntime.h` — BLOCKED: same file as MC2.1
  - RESOLUTION: fold this into **MC2.1** directly. Removed from the queue, MC2.1 acceptance criterion updated to include doc block.

- **MC2.14** — Error surface: Hermes exceptions from `runApplication` propagate to a JS error screen hook
  - Files: `apps/mobile-client/cpp/OnlookRuntime_errorSurface.cpp`
  - Deps: MC2.7
  - Validate: `bun run mobile:e2e:ios -- 10-bundle-throws.yaml` (loads a bundle that throws, asserts the error message surfaces through a `dispatchEvent('onlook:error', …)` callback)

- **MC2.15** — Pre-warm `findNodeAtPoint(-1, -1)` after mount (risk mitigation from source plan)
  - Files: `apps/mobile-client/cpp/InspectorPrewarm.cpp`
  - Deps: MC2.5, MC2.6
  - Validate: `bun run mobile:e2e:ios -- 11-tap-latency.yaml` (first tap after mount returns in < 30ms)

**Wave 2 exit criterion:** `OnlookRuntime.runApplication(redSquareBundle)` paints a red square on both iOS and Android simulators, `reloadBundle` swaps it atomically, and the 241KB runtime is evaluated exactly once per Hermes context.

---

## Wave 3 — Relay client + QR onboarding (parallel; source plan Phase 3)

Goal: fresh app launch → scan QR → load bundle from `cf-expo-relay` → mount.

- **MC3.1** — iOS deep-link scheme registration
  - Files: `apps/mobile-client/ios/OnlookMobile/Info.plist` — BLOCKED: hotspot owned by MCF8
  - RESOLUTION: MCF8 pre-registered the `CFBundleURLTypes` entry for `onlook://`. This task is removed; covered by MCF8.

- **MC3.2** — Android deep-link intent filter
  - Files: `apps/mobile-client/android/app/src/main/AndroidManifest.xml` — BLOCKED: hotspot owned by MCF8
  - RESOLUTION: removed; covered by MCF8.

- **MC3.3** — Deep link parser
  - Files: `apps/mobile-client/src/deepLink/parse.ts`
  - Deps: MCF1
  - Validate: `bun test apps/mobile-client/src/deepLink/parse.test.ts` (`onlook://launch?session=abc&relay=http://localhost:8787` → `{ sessionId: 'abc', relay: 'http://localhost:8787' }`)

- **MC3.4** — Deep link handler (registers OS handler, forwards to router)
  - Files: `apps/mobile-client/src/deepLink/handler.ts`
  - Deps: MC3.3
  - Validate: `bun test apps/mobile-client/src/deepLink/handler.test.ts`

- **MC3.5** — Launcher screen component
  - Files: `apps/mobile-client/src/screens/LauncherScreen.tsx`
  - Deps: MCF1
  - Validate: `bun run mobile:e2e:ios -- 12-launcher-visible.yaml` (asserts "Scan QR" button, "Recent sessions", "Settings" visible)

- **MC3.6** — QR scanner screen using `expo-camera`
  - Files: `apps/mobile-client/src/screens/ScanScreen.tsx`
  - Deps: MCF1
  - Validate: `bun run mobile:e2e:ios -- 13-qr-camera-permission.yaml` (permission dialog, grant, camera view mounts)

- **MC3.7** — QR barcode callback → deep link resolver
  - Files: `apps/mobile-client/src/screens/ScanScreenBarcodeHandler.ts`
  - Deps: MC3.3, MC3.6
  - Validate: `bun test apps/mobile-client/src/screens/__tests__/ScanScreenBarcodeHandler.test.ts`

- **MC3.8** — Recent sessions store (`expo-secure-store`)
  - Files: `apps/mobile-client/src/storage/recentSessions.ts`
  - Deps: MCF1
  - Validate: `bun test apps/mobile-client/src/storage/__tests__/recentSessions.test.ts` (round-trip a fake session, assert it reads back)

- **MC3.9** — Recent sessions UI list
  - Files: `apps/mobile-client/src/screens/RecentSessionsList.tsx`
  - Deps: MC3.8, MC3.5
  - Validate: `bun run mobile:e2e:ios -- 14-recent-sessions.yaml`

- **MC3.10** — Settings screen (relay host override, clear cache, toggle dev menu)
  - Files: `apps/mobile-client/src/screens/SettingsScreen.tsx`
  - Deps: MC3.5
  - Validate: `bun run mobile:e2e:ios -- 15-settings.yaml`

- **MC3.11** — Manifest fetcher
  - Files: `apps/mobile-client/src/relay/fetchManifest.ts`
  - Deps: MCF4
  - Validate: `bun test apps/mobile-client/src/relay/__tests__/fetchManifest.test.ts` (uses `msw` to mock the relay, asserts Zod-parsed output)

- **MC3.12** — Bundle fetcher
  - Files: `apps/mobile-client/src/relay/fetchBundle.ts`
  - Deps: MCF4
  - Validate: `bun test apps/mobile-client/src/relay/__tests__/fetchBundle.test.ts`

- **MC3.13** — WebSocket client (relay upgrade path)
  - Files: `apps/mobile-client/src/relay/websocket.ts`
  - Deps: MCF5
  - Validate: `bun test apps/mobile-client/src/relay/__tests__/websocket.test.ts` (spins up a local WS echo server, asserts `onlook:console` round-trip)

- **MC3.14** — Live reload dispatcher (`bundleUpdate` → `OnlookRuntime.reloadBundle`)
  - Files: `apps/mobile-client/src/relay/liveReload.ts`
  - Deps: MC3.12, MC3.13, MC2.8
  - Validate: `bun run mobile:e2e:ios -- 16-live-reload.yaml` (local relay serves red square, pushes update, asserts screen turns blue)

- **MC3.15** — Manifest version mismatch screen
  - Files: `apps/mobile-client/src/screens/VersionMismatchScreen.tsx`
  - Deps: MCF7, MC3.5
  - Validate: `bun run mobile:e2e:ios -- 17-version-mismatch.yaml` (mock relay serves mismatched runtime version, asserts friendly screen + upgrade CTA)

- **MC3.16** — Version compatibility check hook
  - Files: `apps/mobile-client/src/relay/versionCheck.ts`
  - Deps: MCF7
  - Validate: `bun test apps/mobile-client/src/relay/__tests__/versionCheck.test.ts`

- **MC3.17** — Generic error screen component
  - Files: `apps/mobile-client/src/screens/ErrorScreen.tsx`
  - Deps: MC3.5
  - Validate: `bun run mobile:e2e:ios -- 18-error-screen.yaml`

- **MC3.18** — Debug info collector (`sessionId`, `manifest`, `relayHost`, `clientVersion`, `runtimeVersion`, last 50 logs)
  - Files: `apps/mobile-client/src/debug/collect.ts`
  - Deps: MCF5, MCF7
  - Validate: `bun test apps/mobile-client/src/debug/__tests__/collect.test.ts`

- **MC3.19** — Editor-side QR payload update (emit `onlook://` alongside `exp://`)
  - Files: `apps/web/client/src/components/.../qr-modal/payload.ts` (exact path resolved by the agent via grep for `exp://launch`)
  - Deps: MCF1
  - Validate: `bun test apps/web/client/src/components/**/__tests__/qr-modal.test.ts` (asserts both `exp://` and `onlook://` strings present in the rendered QR payload)
  - Note: Single editor-side touchpoint. After this task, the editor emits QR codes the mobile client can scan.

- **MC3.20** — App router (wires LauncherScreen / ScanScreen / SettingsScreen / ErrorScreen into a stack navigator)
  - Files: `apps/mobile-client/src/App.tsx`
  - Deps: MC3.5, MC3.6, MC3.10, MC3.17
  - Validate: `bun run mobile:e2e:ios -- 19-navigation.yaml` (launcher → scan → back → settings → back)

- **MC3.21** — QR-to-mount end-to-end flow (bundles MC3.3 + MC3.11 + MC3.12 + MC2.7 into one user-level action)
  - Files: `apps/mobile-client/src/flows/scanToMount.ts`
  - Deps: MC3.4, MC3.11, MC3.12, MC2.7, MC3.20
  - Validate: `bun run mobile:e2e:ios -- 20-scan-to-mount.yaml` (local relay serves fixture bundle, Maestro simulates QR scan via deep link, asserts `Hello, Onlook!` rendered)

- **MC3.22** — CI job: Wave 3 Maestro flow runs on both platforms
  - Files: `.github/workflows/mobile-client.yml` (append only — MCF10 reserved the slot)
  - Deps: MC3.21, MCF10
  - Validate: `gh workflow run mobile-client.yml -f phase=wave3` + `gh run watch --exit-status`

**Wave 3 exit criterion:** Scanning an `onlook://launch?session=...` QR code rendered by a local editor loads and mounts the fixture bundle on a simulator, and pushing an update via the relay WebSocket triggers a live reload.

---

## Wave 4 — `OnlookInspector` (parallel; source plan Phase 4)

Goal: click-to-edit on a physical phone. This is the single biggest user-facing differentiator.

iOS and Android paths fan out in parallel — 4.1–4.6 are iOS, 4.7–4.11 are Android, 4.12–4.19 are cross-cutting JS/editor work.

- **MC4.1** — iOS `OnlookInspector.swift` TurboModule registration
  - Files: `apps/mobile-client/ios/OnlookMobile/OnlookInspector.swift`
  - Deps: MCF8, MC2.5
  - Validate: `bun run mobile:e2e:ios -- 21-inspector-global.yaml` (asserts `typeof global.OnlookInspector === 'object'`)

- **MC4.2** — iOS `captureTap(x, y)` — calls `findNodeAtPoint` on `nativeFabricUIManager`
  - Files: `apps/mobile-client/ios/OnlookMobile/OnlookInspector+captureTap.swift`
  - Deps: MC4.1, MCF6
  - Validate: `bun run mobile:e2e:ios -- 22-capture-tap.yaml` (mounts fixture with labelled views, taps at known coordinate, asserts returned `reactTag` matches fixture expectation)

- **MC4.3** — iOS `walkTree(reactTag)` — shadow tree walker using `cloneNodeWithNewChildren` introspection
  - Files: `apps/mobile-client/ios/OnlookMobile/OnlookInspector+walkTree.swift`
  - Deps: MC4.1, MCF6
  - Validate: `bun run mobile:e2e:ios -- 23-walk-tree.yaml`

- **MC4.4** — iOS `captureScreenshot()` — `UIView.snapshot(after:afterScreenUpdates:)` → base64 PNG
  - Files: `apps/mobile-client/ios/OnlookMobile/OnlookInspector+captureScreenshot.swift`
  - Deps: MC4.1
  - Validate: `bun run mobile:e2e:ios -- 24-screenshot.yaml` (base64 decodes to a valid PNG ≥ 100 bytes)

- **MC4.5** — iOS `highlightNode(reactTag, color)` — 2px overlay border, 600ms
  - Files: `apps/mobile-client/ios/OnlookMobile/OnlookInspector+highlight.swift`
  - Deps: MC4.1
  - Validate: `bun run mobile:e2e:ios -- 25-highlight.yaml` (Maestro screenshots before/during/after, compares regions)

- **MC4.6** — iOS tap event forwarder (Fabric root tap → `RCTDeviceEventEmitter`)
  - Files: `apps/mobile-client/ios/OnlookMobile/OnlookInspectorEventForwarder.mm`
  - Deps: MC4.2
  - Validate: `bun run mobile:e2e:ios -- 26-tap-forwarded.yaml`

- **MC4.7** — Android `OnlookInspector.kt` TurboModule registration
  - Files: `apps/mobile-client/android/app/src/main/java/com/onlook/mobile/OnlookInspector.kt`
  - Deps: MCF8, MC2.6
  - Validate: `bun run mobile:e2e:android -- 21-inspector-global.yaml`

- **MC4.8** — Android `captureTap(x, y)`
  - Files: `apps/mobile-client/android/app/src/main/java/com/onlook/mobile/OnlookInspectorCaptureTap.kt`
  - Deps: MC4.7
  - Validate: `bun run mobile:e2e:android -- 22-capture-tap.yaml`

- **MC4.9** — Android `walkTree(reactTag)`
  - Files: `apps/mobile-client/android/app/src/main/java/com/onlook/mobile/OnlookInspectorWalkTree.kt`
  - Deps: MC4.7
  - Validate: `bun run mobile:e2e:android -- 23-walk-tree.yaml`

- **MC4.10** — Android `captureScreenshot()` — `View.draw(canvas)` path
  - Files: `apps/mobile-client/android/app/src/main/java/com/onlook/mobile/OnlookInspectorScreenshot.kt`
  - Deps: MC4.7
  - Validate: `bun run mobile:e2e:android -- 24-screenshot.yaml`

- **MC4.11** — Android `highlightNode(reactTag, color)` + tap forwarder (merged — both touch `OnlookInspectorOverlay.kt`)
  - Files: `apps/mobile-client/android/app/src/main/java/com/onlook/mobile/OnlookInspectorOverlay.kt`
  - Deps: MC4.7, MC4.8
  - Validate: `bun run mobile:e2e:android -- 25-highlight.yaml && bun run mobile:e2e:android -- 26-tap-forwarded.yaml`
  - Note: Intentionally 1-task-2-flows because both features touch the same overlay surface on Android. Source plan's "Android-side `OnlookInspector` parity" cut line is honored — iOS is the blocker for v1 DoD, Android is best-effort.

- **MC4.12** — Sucrase `jsx-source` mode in `@onlook/browser-metro`
  - Files: `packages/browser-metro/src/host/sucrase-jsx-source.ts`
  - Deps: MCF1
  - Validate: `bun test packages/browser-metro/src/host/__tests__/sucrase-jsx-source.test.ts` (asserts emitted JS contains `__source: { fileName, lineNumber, columnNumber }` on JSX calls, gated behind `process.env.NODE_ENV !== 'production'`)

- **MC4.13** — Wire `jsx-source` into `@onlook/browser-metro`'s bundler pipeline
  - Files: `packages/browser-metro/src/host/index.ts` — HOTSPOT: owned by MC4.12 (merged into MC4.12)
  - RESOLUTION: folded into MC4.12 — the test above exercises the wired pipeline end-to-end. Removed from queue.

- **MC4.14** — JS-side tap handler (reads `props.__source`, posts over WS)
  - Files: `apps/mobile-client/src/runtime/inspectorTapHandler.ts`
  - Deps: MC4.6, MC4.12, MCF5
  - Validate: `bun test apps/mobile-client/src/runtime/__tests__/inspectorTapHandler.test.ts`

- **MC4.15** — Editor-side WS receiver for `onlook:select`
  - Files: `apps/web/client/src/server/api/routers/mobile-inspector.ts`
  - Deps: MCF5
  - Validate: `bun test apps/web/client/src/server/api/routers/__tests__/mobile-inspector.test.ts`

- **MC4.16** — Editor-side router registration in `src/server/api/root.ts`
  - Files: `apps/web/client/src/server/api/root.ts` — HOTSPOT. Assigned to this task, single owner.
  - Deps: MC4.15
  - Validate: `bun run typecheck && bun test apps/web/client/src/server/api/__tests__/root.test.ts`

- **MC4.17** — Editor-side Monaco cursor jump on `onlook:select`
  - Files: `apps/web/client/src/components/editor/monaco/cursor-jump-from-mobile.tsx`
  - Deps: MC4.15
  - Validate: `bun test apps/web/client/src/components/editor/monaco/__tests__/cursor-jump-from-mobile.test.tsx` (uses existing editor test rig: posts a fake `onlook:select`, asserts cursor position)

- **MC4.18** — End-to-end inspector flow (device tap → editor cursor jump)
  - Files: `apps/mobile-client/e2e/flows/27-tap-to-editor.yaml` + fixture bundle
  - Deps: MC4.6, MC4.14, MC4.17
  - Validate: `bun run mobile:e2e:ios -- 27-tap-to-editor.yaml` (spins local editor + local relay, loads fixture bundle with a button, taps button, asserts mock Monaco cursor-jump endpoint received `{ file: 'App.tsx', line: 12, column: 8 }`)
  - Note: iOS only. Android parity is dead-letter per source-plan cut line.

- **MC4.19** — CI job: Wave 4 iOS flows (Android flows gated on MC4.11 optimistic inclusion)
  - Files: `.github/workflows/mobile-client.yml` (append)
  - Deps: MC4.18, MCF10
  - Validate: `gh workflow run mobile-client.yml -f phase=wave4 && gh run watch --exit-status`

**Wave 4 exit criterion:** On iOS Simulator, tapping a button in a fixture bundle causes the locally-running editor's Monaco instance to jump its cursor to the right file/line/column. Android has feature parity for `captureTap` / `walkTree` / `captureScreenshot` but the full tap-to-cursor flow is iOS-only per the source plan cut line.

---

## Wave 5 — Built-in debug surface (parallel; source plan Phase 5)

Goal: console relay, network inspector, error boundary, in-app dev menu. All flow over the same relay WebSocket the runtime already uses for `onlook:select`.

- **MC5.1** — Console relay: intercept `console.log/warn/error` in the runtime bundle
  - Files: `packages/mobile-preview/runtime/console-relay.js`
  - Deps: MCF5
  - Validate: `bun test packages/mobile-preview/runtime/__tests__/console-relay.test.js`
  - Note: Lives in the runtime package because it ships baked into the binary. Phase F's runtime asset wiring picks it up automatically on next build.

- **MC5.2** — Console relay: native streaming side (forwards log entries to the relay WS)
  - Files: `apps/mobile-client/src/debug/consoleStreamer.ts`
  - Deps: MC5.1, MC3.13
  - Validate: `bun test apps/mobile-client/src/debug/__tests__/consoleStreamer.test.ts`

- **MC5.3** — Network inspector: `fetch` patch in runtime bundle
  - Files: `packages/mobile-preview/runtime/network-fetch-patch.js`
  - Deps: MCF5
  - Validate: `bun test packages/mobile-preview/runtime/__tests__/network-fetch-patch.test.js`

- **MC5.4** — Network inspector: `XMLHttpRequest` patch in runtime bundle
  - Files: `packages/mobile-preview/runtime/network-xhr-patch.js`
  - Deps: MCF5
  - Validate: `bun test packages/mobile-preview/runtime/__tests__/network-xhr-patch.test.js`

- **MC5.5** — Network inspector: wire format + streamer
  - Files: `apps/mobile-client/src/debug/networkStreamer.ts`
  - Deps: MC5.3, MC5.4, MC3.13
  - Validate: `bun test apps/mobile-client/src/debug/__tests__/networkStreamer.test.ts`

- **MC5.6** — Error boundary in runtime bundle (catches React errors)
  - Files: `packages/mobile-preview/runtime/error-boundary.js`
  - Deps: MCF5
  - Validate: `bun test packages/mobile-preview/runtime/__tests__/error-boundary.test.js`

- **MC5.7** — Native JS exception catcher (Hermes exceptions from `runApplication`)
  - Files: `apps/mobile-client/cpp/OnlookRuntime_exceptionCatcher.cpp`
  - Deps: MC2.14
  - Validate: `bun run mobile:e2e:ios -- 28-native-exception.yaml`

- **MC5.8** — Crash overlay UI (friendly "your app crashed" + "view in editor" CTA)
  - Files: `apps/mobile-client/src/screens/CrashOverlay.tsx`
  - Deps: MC5.6, MC5.7
  - Validate: `bun run mobile:e2e:ios -- 29-crash-overlay.yaml`

- **MC5.9** — Dev menu component (React, shipped inside runtime bundle)
  - Files: `packages/mobile-preview/runtime/dev-menu/Menu.js`
  - Deps: MCF5
  - Validate: `bun test packages/mobile-preview/runtime/dev-menu/__tests__/Menu.test.js`

- **MC5.10** — Dev menu trigger: three-finger long-press gesture handler
  - Files: `packages/mobile-preview/runtime/dev-menu/gesture.js`
  - Deps: MC5.9
  - Validate: `bun test packages/mobile-preview/runtime/dev-menu/__tests__/gesture.test.js`
  - Note: Maestro can simulate multi-finger gestures on iOS Simulator. If the agent discovers it can't for Android, this task gets an Android `device-only` follow-up.

- **MC5.11** — Dev menu action: reload bundle
  - Files: `packages/mobile-preview/runtime/dev-menu/actions/reload.js`
  - Deps: MC5.9, MC2.8
  - Validate: `bun test packages/mobile-preview/runtime/dev-menu/actions/__tests__/reload.test.js`

- **MC5.12** — Dev menu action: clear async storage
  - Files: `packages/mobile-preview/runtime/dev-menu/actions/clearStorage.js`
  - Deps: MC5.9
  - Validate: `bun test packages/mobile-preview/runtime/dev-menu/actions/__tests__/clearStorage.test.js`

- **MC5.13** — Dev menu action: toggle inspector overlay
  - Files: `packages/mobile-preview/runtime/dev-menu/actions/toggleInspector.js`
  - Deps: MC5.9, MC4.5
  - Validate: `bun test packages/mobile-preview/runtime/dev-menu/actions/__tests__/toggleInspector.test.js`

- **MC5.14** — Dev menu action: copy session ID
  - Files: `packages/mobile-preview/runtime/dev-menu/actions/copySessionId.js`
  - Deps: MC5.9
  - Validate: `bun test packages/mobile-preview/runtime/dev-menu/actions/__tests__/copySessionId.test.js`

- **MC5.15** — Dev menu action: view recent logs
  - Files: `packages/mobile-preview/runtime/dev-menu/actions/viewLogs.js`
  - Deps: MC5.9, MC5.1
  - Validate: `bun test packages/mobile-preview/runtime/dev-menu/actions/__tests__/viewLogs.test.js`

- **MC5.16** — Editor-side dev panel: console stream rendering
  - Files: `apps/web/client/src/components/editor/dev-panel/MobileConsoleTab.tsx`
  - Deps: MC5.2, MC4.15
  - Validate: `bun test apps/web/client/src/components/editor/dev-panel/__tests__/MobileConsoleTab.test.tsx`

- **MC5.17** — Editor-side dev panel: network stream rendering
  - Files: `apps/web/client/src/components/editor/dev-panel/MobileNetworkTab.tsx`
  - Deps: MC5.5, MC4.15
  - Validate: `bun test apps/web/client/src/components/editor/dev-panel/__tests__/MobileNetworkTab.test.tsx`

- **MC5.18** — CI job: Wave 5 flows
  - Files: `.github/workflows/mobile-client.yml` (append)
  - Deps: MC5.8, MC5.10, MCF10
  - Validate: `gh workflow run mobile-client.yml -f phase=wave5 && gh run watch --exit-status`

**Wave 5 exit criterion:** `console.log` on-device streams to the editor's dev panel in <100ms, `fetch` calls appear in the editor's network panel, React errors show a friendly overlay with a "view in editor" CTA, and three-finger long-press opens an in-app dev menu on iOS Simulator.

---

## Wave 6 — Distribution (mostly parallel; source plan Phase 6)

- **MC6.1** — Binary version constant (single source of truth consumed by both iOS and Android builds)
  - Files: `apps/mobile-client/src/version.ts`
  - Deps: MCF7
  - Validate: `bun test apps/mobile-client/src/__tests__/version.test.ts` (asserts version matches `packages/mobile-client-protocol`'s `runtime-version.ts`)

- **MC6.2** — Relay manifest-builder update (adds `extra.expoClient.onlookRuntimeVersion`)
  - Files: `apps/cf-expo-relay/src/manifest-builder.ts`
  - Deps: MCF4, MC6.1
  - Validate: `bun test apps/cf-expo-relay/src/__tests__/manifest-builder.test.ts`
  - Note: The only cf-expo-relay touchpoint in this entire queue. Hotspot ownership explicit.

- **MC6.3** — `@onlook/browser-metro` `target` flag (`expo-go` | `onlook-client`)
  - Files: `packages/browser-metro/src/host/target.ts`
  - Deps: MCF3
  - Validate: `bun test packages/browser-metro/src/host/__tests__/target.test.ts` (asserts `target: 'onlook-client'` bundles OMIT the 241KB runtime prelude, `target: 'expo-go'` keeps it)
  - Note: Risk mitigation from source plan's "Dual-shell maintenance burden" row.

- **MC6.4** — Bundle-time `react` version guard in browser-metro
  - Files: `packages/browser-metro/src/host/react-version-guard.ts`
  - Deps: MCF7
  - Validate: `bun test packages/browser-metro/src/host/__tests__/react-version-guard.test.ts` (refuses to bundle when user's `react` major ≠ runtime's)

- **MC6.5** — iOS TestFlight build config (`eas.json` + build scripts)
  - Files: `apps/mobile-client/eas.json`, `apps/mobile-client/scripts/build-testflight.sh`
  - Deps: MCF8
  - Validate: `bun run mobile:build:testflight --dry-run` (runs xcodebuild with an archive target, doesn't upload; validates config)

- **MC6.6** — Android Play Store internal-track build config
  - Files: `apps/mobile-client/scripts/build-play-internal.sh`
  - Deps: MCF8
  - Validate: `bun run mobile:build:play-internal --dry-run`

- **MC6.7** — CI job: TestFlight upload (dry-run-only by default, gated on secret)
  - Files: `.github/workflows/mobile-client.yml` (append)
  - Deps: MC6.5, MCF10
  - Validate: `gh workflow run mobile-client.yml -f phase=testflight-dryrun && gh run watch --exit-status`

- **MC6.8** — CI job: Play Store upload (dry-run-only by default)
  - Files: `.github/workflows/mobile-client.yml` (append)
  - Deps: MC6.6, MCF10
  - Validate: `gh workflow run mobile-client.yml -f phase=play-dryrun && gh run watch --exit-status`

- **MC6.9** — Release checklist doc
  - Files: `apps/mobile-client/RELEASE.md`
  - Deps: MC6.5, MC6.6
  - Validate: `test -f apps/mobile-client/RELEASE.md && grep -q 'TestFlight' apps/mobile-client/RELEASE.md`

**Wave 6 exit criterion:** TestFlight and Play internal-track builds produce signed artifacts in CI (dry-run upload). Bundles served to the custom client omit the runtime prelude (~250KB → ~5–20KB per source plan target).

---

## Wave I — Integration + Definition of Done

Sequential. Runs with 1 agent after Wave 6 merges. This is where the source plan's DoD gets verified end-to-end.

- **MCI.1** — Full pipeline integration: editor + relay + simulator
  - Files: `apps/mobile-client/e2e/flows/99-full-pipeline.yaml`
  - Deps: ALL of Wave 3, Wave 4 iOS side, Wave 5
  - Validate: `bun run mobile:e2e:ios -- 99-full-pipeline.yaml` (source-plan DoD steps 1–7 as a single Maestro flow: QR scan → mount → edit in editor → live reload → tap → editor cursor jump → dev menu → console visible)

- **MCI.2** — Binary size audit
  - Files: `apps/mobile-client/scripts/audit-binary-size.ts`
  - Deps: MC6.5, MC6.6
  - Validate: `bun run mobile:audit:size` (asserts iOS IPA ≤ 40MB, Android APK ≤ 35MB — calibration values; agent adjusts to observed baseline + 10%)

- **MCI.3** — Bundle size audit (post target-flag)
  - Files: `apps/mobile-client/scripts/audit-bundle-size.ts`
  - Deps: MC6.3
  - Validate: `bun run mobile:audit:bundle-size` (asserts `target: 'onlook-client'` bundle for the `Hello, Onlook!` fixture ≤ 20KB)

- **MCI.4** — Protocol drift test (N-1 compatibility for 30 days)
  - Files: `packages/mobile-client-protocol/src/__tests__/protocol-drift.test.ts`
  - Deps: MCF5
  - Validate: `bun test packages/mobile-client-protocol/src/__tests__/protocol-drift.test.ts`

- **MCI.5** — **`device-only`** physical iPhone walk of DoD steps 1–7
  - Files: `apps/mobile-client/verification/device-walks/01-dod-full.md`
  - Deps: MCI.1
  - Validate: human writes `results.json` entry with `state: "passed"` + photo evidence
  - Note: Dead-letter until human marks passed. This is the only task in the entire queue that genuinely requires a physical device — everything else runs on simulator/emulator. See "Dead letter policy" below.

- **MCI.6** — Merge `feat/mobile-client` → `main`
  - Files: —
  - Deps: MCI.1, MCI.2, MCI.3, MCI.4 (MCI.5 is dead-letter and does NOT block the merge; it blocks TestFlight submission)
  - Validate: `git merge --no-ff feat/mobile-client` on `main` + full CI green on `main` post-merge
  - Note: Human-gated. Agent prepares the PR; a maintainer actually merges.

---

## Dead letter policy

Tasks that hit any of these conditions flip to dead-letter and surface to a human:

1. **Retry budget exhausted.** 3 attempts with test output fed as context. After the third, stop and escalate.
2. **Scope creep detected.** The agent reports it needs to touch a file outside its `.claude/rules.md`. Orchestrator does not un-scope — it dead-letters and flags for re-decomposition.
3. **Hotspot file conflict.** The agent's diff touches a hotspot owned by another task. Orchestrator rejects the merge and dead-letters.
4. **`device-only` tasks.** Always dead-letter on first run. Human walks the scenario, updates `results.json`, orchestrator re-runs the validate command (which is just a jq check), and the task closes.
5. **Wave integration failure.** If a task's individual validate passes but the `feat/mobile-client` integration check after merge fails, the orchestrator **reverts the merge**, dead-letters the task, and continues with the next one. The reverted task needs human triage before it can be re-queued.

Dead letter queue lives at `apps/mobile-client/verification/dead-letter.json`. Orchestrator appends; humans resolve.

---

## Open questions the decomposition did not resolve

These are explicit holes in the source plan that the decomposition surfaced. Each deserves an ADR before the tasks that depend on them leave dead-letter:

1. **Maestro vs. Detox for e2e.** MCF9 picks Maestro on the strength of its YAML simplicity, but `packages/browser-metro` has no prior art and Detox has better physical-device support. If Maestro can't drive the three-finger long-press in Wave 5 (MC5.10), the decomposition needs a framework swap and every `bun run mobile:e2e:*` command changes. Low probability, high blast radius.
2. **Runtime asset versioning across `feat/mobile-client` long-running-branch lifespan.** MCF11 wires `packages/mobile-preview/runtime/bundle.js` into the iOS/Android binary at build time. But that runtime file is under active development elsewhere in the repo. If it churns during the queue's run, every Wave 2 task silently rebuilds against a different runtime. **Mitigation:** pin the runtime commit hash in `apps/mobile-client/scripts/bundle-runtime.ts` and only bump it via an explicit task (add `MCF11b` if this becomes a problem).
3. **Xcode project.pbxproj merge conflicts despite MCF8's pre-population.** MCF8 pre-registers stub files, but if any Wave 2/3/4 task discovers it needs a file type MCF8 didn't anticipate (e.g., a `.metal` shader, a storyboard), the hotspot assumption breaks. **Mitigation:** dead-letter any task that needs a new pbxproj entry; a human adds it via a follow-up MCF8-extension task.
4. **Editor-side touchpoints are under-scoped.** The queue has three editor-side tasks (MC3.19, MC4.15/16/17, MC5.16/17) that all land in `apps/web/client`. The source plan references an "existing dev panel" but the decomposition didn't verify that panel's shape before assigning file paths. Those paths are best-effort and the agents working those tasks should grep for real file locations and adjust the task's Files field as they go. This is the only place in the queue where the task's file list is treated as a hint rather than a contract.
5. **Sucrase `jsx-source` fidelity.** MC4.12 assumes Sucrase has a hook point that can emit `__source`. If not, the agent needs to fall back to a Babel plugin, which adds a bundler dep and a parse pass. **Mitigation:** the task's first retry should dead-letter immediately on "no hook point," and a human decides whether to add Babel or change the inspector approach to something source-less (e.g., `findNode` + view-name heuristics).

None of these block Phase F or Wave 1. They get resolved as Waves 2–5 encounter them.

---

## Orchestrator invocation

From the root of `onlook/` on `feat/mobile-client` cut from `main`:

```bash
# Phase F — serial, one agent
claude --task-queue plans/onlook-mobile-client-task-queue.md --phase F --concurrency 1

# Waves 1–6 — parallel up to 8 agents
claude --task-queue plans/onlook-mobile-client-task-queue.md --phase 1 --concurrency 8
claude --task-queue plans/onlook-mobile-client-task-queue.md --phase 2 --concurrency 8
claude --task-queue plans/onlook-mobile-client-task-queue.md --phase 3 --concurrency 8
claude --task-queue plans/onlook-mobile-client-task-queue.md --phase 4 --concurrency 8
claude --task-queue plans/onlook-mobile-client-task-queue.md --phase 5 --concurrency 8
claude --task-queue plans/onlook-mobile-client-task-queue.md --phase 6 --concurrency 8

# Wave I — serial, one agent, dead-letter tolerant
claude --task-queue plans/onlook-mobile-client-task-queue.md --phase I --concurrency 1 --allow-dead-letter
```

Each `claude --task-queue` invocation is expected to:
1. Read the wave's pending pool from this file
2. For each task: `git worktree add -b ai/<task-id>-<slug> .trees/<task-id>-<slug> feat/mobile-client`
3. Drop `.claude/rules.md` into the worktree with the Files list as the scope guard
4. Spawn an agent in the worktree with the task's description as the prompt
5. Run the task's `validate` command; retry 3× with test output as context on failure
6. On pass: merge to `feat/mobile-client` in dependency order
7. On fail: append to `dead-letter.json`, continue with next task
8. When the wave drains, report to `results.json` and exit
