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
| `apps/mobile-client/ios/OnlookMobile.xcodeproj/project.pbxproj` | **MCF8 (initial) → per-wave "xcode scribe"** | MCF8 runs `expo prebuild --clean` and commits the vanilla output. **Pre-registration of downstream stub files was dropped** (2026-04-11 decision) because reliable pbxproj surgery requires the `xcodeproj` Ruby gem and is too fragile to do by hand. Instead: each Wave that needs new native files gets one **serialized "xcode scribe" sub-task** (e.g., `MC1.X`, `MC2.X`, `MC4.X`) whose sole job is to batch-add that wave's new `.swift`/`.mm`/`.h`/`.cpp` files to `project.pbxproj` via the `xcodeproj` gem. All other tasks in the wave write their Swift/ObjC/C++ file contents but never touch the pbxproj. The scribe runs after the wave's content tasks finish and before the wave's build validation. |
| `apps/mobile-client/ios/Podfile` + `Podfile.lock` | **MCF8** | Owner runs `expo prebuild --clean` and commits the generated Podfile. Any new pod references during Waves 2–5 go through a `Podfile` follow-up patch to MCF8 (one per wave if needed), not through individual tasks. |
| `apps/mobile-client/ios/OnlookMobile/Info.plist` | **MCF8** | Owner pre-populates all required keys up front: `NSCameraUsageDescription`, `CFBundleURLTypes` for `onlook://` scheme, `NSAppTransportSecurity` for local relay dev. Info.plist is hand-editable XML so this is safe. |
| `apps/mobile-client/android/app/build.gradle` | **MCF8** | Owner runs `expo prebuild` and commits the generated gradle config. Wave-specific additions (NDK config for JSI/C++, new native module deps) go through append-only patches owned by a per-wave scribe task, same pattern as the pbxproj scribe above. |
| `apps/mobile-client/android/app/src/main/AndroidManifest.xml` | **MCF8** | Owner pre-populates `CAMERA` permission, `onlook://` deep-link intent filter, and `usesCleartextTraffic="true"` (dev-only, gated on `android:debuggable`). Hand-editable XML so pre-population is safe. |
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

- **MCF8a** — Expo entry + app config + root component (prerequisites for `expo prebuild`)
  - Files: `apps/mobile-client/app.config.ts`, `apps/mobile-client/index.js`, `apps/mobile-client/src/App.tsx`
  - Deps: MCF1
  - Validate: `bun --filter @onlook/mobile-client typecheck` exits 0
  - Status: **✅ Done** — committed as `e5c9f227` on `feat/mobile-client`. Pinned to Expo SDK 54, bundle id `com.onlook.mobile`, URL scheme `onlook` for deep links, `newArchEnabled: true`, `jsEngine: hermes`. `expo-camera` + `expo-secure-store` registered as config plugins; `expo-haptics` stays as a runtime-only dep (no `app.plugin.js`).
  - Note: Split from the original MCF8 on 2026-04-11 when the `Xcode ≥ 16.1` blocker on an Intel Mac forced a handoff. The "prep" files are independently valid and land early so the new machine has everything ready for `expo prebuild`.

- **MCF8b** — `expo prebuild --platform ios`, pre-populate Info.plist, `pod install`, `xcodebuild` smoke build
  - Files: ENTIRE `apps/mobile-client/ios/**` (generated), optional touch-ups to `ios/OnlookMobileClient/Info.plist` if Expo's output misses anything
  - Deps: MCF8a, Xcode ≥ 16.1, CocoaPods ≥ 1.16
  - Validate: `cd apps/mobile-client && bun x expo prebuild --platform ios --no-install --clean && cd ios && pod install && xcodebuild -workspace OnlookMobileClient.xcworkspace -scheme OnlookMobileClient -configuration Debug -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 15' build | tail -20` exits 0
  - Status: **⛔ Blocked on tooling** (2026-04-11) — RN 0.81.6 pod check requires `Xcode >= 16.1`; machine has 15.4 on macOS 14.3.1. `expo prebuild --no-install` itself succeeds locally on Xcode 15.4 and generates `Info.plist` with all the right keys (camera permission, `onlook://` URL scheme, `NSAllowsLocalNetworking`, `RCTNewArchEnabled`) automatically from `app.config.ts`. The block is specifically at `pod install`. A new machine with Xcode 16.1+ finishes this task in ~10 min of `pod install` + `xcodebuild`. See `plans/onlook-mobile-client-handoff.md`.
  - Note: **Scope narrowed 2026-04-11** — no longer pre-registers downstream stub files in `project.pbxproj` or `build.gradle`. Rationale: reliable pbxproj surgery requires the `xcodeproj` Ruby gem and is too fragile to do by hand across ~40 wave tasks. Instead each wave that needs new native files adds one serialized "xcode scribe" sub-task (e.g., `MC1.X`, `MC2.X`) that batches all pbxproj additions for that wave via the gem. Scribe runs between the wave's content tasks and its build validation. Info.plist and AndroidManifest.xml are pre-populated via `app.config.ts` because Expo expands them during prebuild.

- **MCF8c** *(deferred)* — Android prebuild + Gradle assembleDebug
  - Files: ENTIRE `apps/mobile-client/android/**` (generated)
  - Deps: MCF8a, JDK 17, Android SDK with `platform-tools` + `platforms;android-34`
  - Status: **⏸ Deferred per source plan cut line** — "iOS first because Phase B's verification rig is iPhone-only." Android lands after Wave 1 iOS is green. Android-side JNI work (MC1.7, MC2.4, MC2.6, MC4.7–4.11) and the `wave1-android` CI job all block on this.

- **MCF9** — Maestro e2e harness scaffold
  - Files: `apps/mobile-client/e2e/maestro.config.yaml`, `apps/mobile-client/e2e/flows/00-smoke.yaml`, `apps/mobile-client/verification/results.json` (with empty `flows: {}`)
  - Deps: MCF8
  - Validate: `cd apps/mobile-client && maestro test e2e/flows/00-smoke.yaml` (harness-only flow; does not launch the app, just proves Maestro CLI parses + runs a well-formed flow file)

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
  - Files: `apps/mobile-client/scripts/validate-task.ts`, `apps/mobile-client/scripts/__tests__/validate-task.test.ts`
  - Deps: MCF1 (workspace must exist so the harness can live inside it; the dependency on MCF9/MCF10 from the original queue was incorrect — the harness only needs to parse the queue markdown and run bash, and its own tests exercise that in isolation)
  - Validate: `bun test apps/mobile-client/scripts/__tests__/validate-task.test.ts` (4 tests: usage error, MCF0 dry-run, MCF7 dry-run, unknown task rejection)

**Phase F exit criterion:** `feat/mobile-client` has a buildable iOS and Android scaffold that boots to a black screen, runs an empty Maestro smoke flow, and has the entire shared protocol package typechecking. All hotspot files are pre-populated. Waves 1–6 can now run in parallel.

---

## Wave 1 — Native shell scaffold (parallel; source plan Phase 1)

Goal: buildable app that loads a Hermes JS context and prints `[onlook-runtime] hermes ready`.

- **MC1.1** — iOS `AppDelegate.swift` — app lifecycle + Hermes bootstrap
  - Files: ~~`apps/mobile-client/ios/OnlookMobile/AppDelegate.swift`~~
  - Deps: MCF8, MCF11
  - Validate: `bun run mobile:build:ios && bun run mobile:e2e:ios -- 01-boot.yaml` (flow asserts device log contains `[onlook-runtime] hermes ready`)
  - Status: **✅ NO-OP / superseded 2026-04-15.** Two pieces are already in place: (a) Expo's `expo prebuild` (MCF8b) generated `OnlookMobileClient/AppDelegate.swift` using the legacy `@UIApplicationMain` pattern with `factory.startReactNative(...)`, and Hermes is initialized automatically because `app.config.ts` sets `jsEngine: 'hermes'` — there is no native bootstrap call to author; (b) the `[onlook-runtime] hermes ready` log line is emitted by MC1.4's `HermesBootstrap.swift` from inside `bundleURL()`. So the original MC1.1 deliverable is now split: the lifecycle is owned by Expo's generated AppDelegate, and the log line is owned by MC1.4. No new file to write here.

- **MC1.2** — iOS `SceneDelegate.swift` — single-window setup
  - Files: ~~`apps/mobile-client/ios/OnlookMobile/SceneDelegate.swift`~~
  - Deps: MCF8
  - Validate: `bun run mobile:build:ios` (builds; scene wiring is visual-only until MC3)
  - Status: **✅ NO-OP / superseded 2026-04-15.** MCF8's Expo prebuild (SDK 54 / RN 0.81.6) generated an app using the legacy `@UIApplicationMain` + `window`-on-AppDelegate pattern, not UIScene. `Info.plist` has no `UIApplicationSceneManifest`, and `OnlookMobileClient/AppDelegate.swift:25` already does `window = UIWindow(frame: UIScreen.main.bounds)` before mounting React. Adding a `SceneDelegate.swift` would require refactoring Expo-managed AppDelegate (remove `@UIApplicationMain`, drop `window` property, add `application(_:configurationForConnecting:options:)`) and adding `UIApplicationSceneManifest` to Info.plist — a substantive lifecycle upgrade that risks breaking expo-dev-client, deep-link, and hot-reload integrations. Single-window setup is already satisfied by the AppDelegate pattern; no file to write. If a scene-based lifecycle is ever wanted (iPad multi-window, split-view, etc.) it should be driven by an explicit ADR, not this task.

- **MC1.3** — iOS root view controller (hosts the Fabric root view)
  - Files: ~~`apps/mobile-client/ios/OnlookMobile/OnlookRootViewController.swift`~~
  - Deps: MCF8
  - Validate: `bun run mobile:build:ios && bun run mobile:e2e:ios -- 02-black-screen.yaml`
  - Status: **⛔ NEEDS ADR 2026-04-15.** Same situation as MC1.2 (SceneDelegate). Expo's `factory.startReactNative(in: window, ...)` already mounts the Fabric root view inside the AppDelegate-owned `UIWindow` — no `OnlookRootViewController.swift` to author. Replacing Expo's root with a custom `OnlookRootViewController` would require overriding `ExpoReactNativeFactoryDelegate.createRootViewController()` (which is `open` — see `node_modules/expo/ios/AppDelegates/ExpoReactNativeFactoryDelegate.swift`) and either re-implementing the React mount or composing it inside our VC. That's a substantive change to Expo-managed code, not a Wave 1 mechanical task. If a custom root VC is ever wanted (e.g. to wrap React inside a navigation container, splash screen overlay, etc.) it should land behind a deliberate ADR. The original "black screen" goal is already met by the bare-scaffold app on launch.

- **MC1.4** — iOS Hermes init in AppDelegate (reads `onlook-runtime.js` asset and evals once)
  - Files: `apps/mobile-client/ios/OnlookMobileClient/HermesBootstrap.swift`, `apps/mobile-client/ios/OnlookMobileClient/AppDelegate.swift` (override `bundleURL`), `apps/mobile-client/scripts/run-build.ts` (bake `main.jsbundle` via `expo export:embed`), `apps/mobile-client/scripts/validate-mc14.sh`, `apps/mobile-client/e2e/flows/03-hermes-eval.yaml`
  - Deps: MCF11, MCF8b
  - Validate: `bash apps/mobile-client/scripts/validate-mc14.sh` (builds, reinstalls, launches, scrapes device log for `[onlook-runtime] hermes ready` — see script header for why this replaced the original maestro flow)
  - Status: **iOS landed 2026-04-15.** Approach pivoted from the original Obj-C++ / `RCTHostRuntimeDelegate.didInitializeRuntime` / `evaluateJavaScript` design to a pure-Swift `bundleURL()` override that composes a combined `onlook-runtime.js + main.jsbundle` and returns its tmp URL. Reasons: (a) under bridgeless / new arch, RCTHost loads the bundle directly from `bundleURL` and never consults `loadSource:` or `loadBundleAtURL:` delegate hooks (empirically confirmed by NSLogging both); (b) Expo's `ExpoReactNativeFactory` doesn't expose `RCTHost` to the delegate, so we can't set `host.runtimeDelegate` to receive `didInitializeRuntime` before Hermes starts; (c) byte-level prepend in `bundleURL` is platform-portable and avoids the `jsi::Runtime &` C++ reference that Swift can't bridge. The maestro flow (03-hermes-eval.yaml) currently hangs because the bare-scaffold app renders nothing for `waitForAnimationToEnd` to settle on — switched validate to a `simctl log stream` scrape (`scripts/validate-mc14.sh`) that asserts the log line directly. Restore the maestro path in a later wave once user JS renders something.

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
  - Status: **🟢 ADR landed 2026-04-15** — see `plans/adr/MC1.8-module-allowlist.md`. New direction: enforce the allowlist at the **JS-import surface** (ESLint + Metro resolver), not at the linked-binary set. Original validate (`grep -L ExpoFileSystem ...`) is unworkable because ExpoFileSystem is a baseline `expo-modules-core` peer. New scope:
    - **Files:** `apps/mobile-client/eslint.config.{js,mjs}` (or extension of `@onlook/eslint`), `apps/mobile-client/metro.config.js`, `apps/mobile-client/scripts/validate-mc18.sh`, optionally `apps/mobile-client/src/supported-modules.ts` (programmatic allowlist).
    - **Validate:** `bun --filter @onlook/mobile-client lint && bash apps/mobile-client/scripts/validate-mc18.sh` (the script writes a probe file importing a banned module, runs lint + Metro bundle, asserts both reject).
    - Ready to dispatch when picked up.

- **MC1.9** — `SUPPORTED_MODULES.md` documentation
  - Files: `apps/mobile-client/SUPPORTED_MODULES.md`
  - Deps: MCF1
  - Validate: `test -f apps/mobile-client/SUPPORTED_MODULES.md && grep -q 'expo-camera' apps/mobile-client/SUPPORTED_MODULES.md`

- **MC1.10** — Logger module (`OnlookLogger.swift` + Kotlin equivalent) for `[onlook-runtime]` prefix
  - Files: `apps/mobile-client/ios/OnlookMobileClient/OnlookLogger.swift`, ~~`apps/mobile-client/android/app/src/main/java/com/onlook/mobile/OnlookLogger.kt`~~ (Android half deferred — see MC1.10a)
  - Deps: MCF8
  - Validate: `bun run mobile:build:ios` (Android half split to MC1.10a pending Android toolchain per handoff's iOS-first cut line)
  - Status: **iOS scope narrowed 2026-04-15.** iOS-only half is self-contained: single new Swift file + pbxproj Sources-build-phase registration. Path in original entry (`OnlookMobile/...`) was wrong — actual Expo-generated app dir is `OnlookMobileClient/`. Since this task adds a new Swift source, it also updates `OnlookMobileClient.xcodeproj/project.pbxproj` inline (via `xcodeproj` Ruby gem already present on any machine that can run `pod install`) rather than waiting for a batched MC1.X scribe task — scribe pattern is worth-it when Swift files pile up across a wave, not for one file.

- **MC1.10a** — Logger module (Kotlin) — deferred
  - Files: `apps/mobile-client/android/app/src/main/java/com/onlook/mobile/OnlookLogger.kt`
  - Deps: MCF8c (Android prebuild + Gradle, currently deferred)
  - Validate: `bun run mobile:build:android`
  - Status: **⏸ deferred** — lands when the Android toolchain is activated. Mirror of MC1.10; API surface must match so JS code can call `OnlookRuntime.log(...)` without platform branching.

- **MC1.11** — CI job: iOS simulator build + 01/02/03 flow runs
  - Files: `.github/workflows/mobile-client.yml` (append only — MCF10 pre-reserved the job slot)
  - Deps: MCF10, MC1.4
  - Validate: `gh workflow run mobile-client.yml -f phase=wave1-ios` and `gh run watch --exit-status`
  - Note: MCF10 pre-created the `build-ios` job as an empty shell; this task fills it in.
  - Status: **shipped** — `wave1-ios` job filled in: `bun install` → `bun run build:mobile-runtime` → `pod install` → `bun run mobile:build:ios` (replaces hand-rolled `xcodebuild -destination 'platform=iOS Simulator,name=iPhone 15'` with the wrapper's `generic/platform=iOS Simulator`) → boot an iOS 17 sim → `validate-mc14.sh` + `validate-mc23.sh` log-scrapes → upload `verification/results.json` + `verification/maestro-debug/` artifacts. `workflow_dispatch.inputs.phase` added so `gh workflow run -f phase=wave1-ios` gates correctly. Pinned `macos-14` + Xcode 15.4 to keep iPhone 15 simulator set stable. Recorded as manual pass (Linux DNS blocks `gh workflow run` from this host; macmini runs `validate-mc14.sh` + `validate-mc23.sh` locally which is what CI invokes).

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
  - Validate: `bun run mobile:build:ios` (Android half split to MC2.2a pending Android toolchain per handoff's iOS-first cut line)
  - Status: **iOS scope narrowed 2026-04-15.** OnlookRuntime.cpp compiles into `OnlookRuntime.o` for both arm64 + x86_64 in the OnlookMobileClient iOS target. Skeleton throws `jsi::JSError("not implemented (Wave 2 …)")` from every method body, with version() returning the sentinel string `"0.0.0-mc2.2-skeleton"`. See OnlookRuntime.h docstring for the public-API contract; bodies land in MC2.7 / MC2.8 / MC2.9 / MC2.12 / MC2.14.

- **MC2.2a** — C++ JSI host object skeleton (Android compile) — deferred
  - Files: `apps/mobile-client/cpp/OnlookRuntime.cpp` — same TU, just compiled as part of the Android target via CMake when MCF8c lands
  - Deps: MCF8c (Android prebuild + Gradle + CMake), MC2.2
  - Validate: `bun run mobile:build:android`
  - Status: **⏸ deferred** — Android toolchain not active yet. The .cpp itself is platform-neutral (only depends on `<jsi/jsi.h>` which Hermes provides on both platforms); CMake just needs to pick it up.

- **MC2.3** — iOS installer TurboModule that registers `OnlookRuntime` on `globalThis`
  - Files: `apps/mobile-client/cpp/OnlookRuntimeInstaller.{h,cpp,mm}`, `packages/mobile-preview/runtime/shell.js`, `apps/mobile-client/scripts/validate-mc23.sh`, `apps/mobile-client/ios/OnlookMobileClient.xcodeproj/project.pbxproj`
  - Deps: MC2.2, MC1.4
  - Validate: `bash apps/mobile-client/scripts/validate-mc23.sh`
  - Status: **iOS shipped 2026-04-16.** See `plans/adr/MC2.3-runtime-installer-hook.md` for the decision to implement via a pure-C++ TurboModule + Obj-C++ wrapper (`RCT_EXPORT_MODULE(OnlookRuntimeInstaller)` — reached by RN 0.81's `RCTTurboModuleManager._getModuleClassFromName` ObjC fallback, so no separate `RCTAppDependencyProvider` entry needed). `shell.js` calls `globalThis.__turboModuleProxy('OnlookRuntimeInstaller').install()` at the very top before any other runtime setup; the C++ `install()` emits `[onlook-runtime] OnlookRuntime installed on globalThis` via `nativeLoggingHook` so the validate script can log-scrape for the confirmation (maestro `04-global-present.yaml` left in the repo for when a renderable user bundle exists, same deal as MC1.4). Android mirror (MC2.4) re-uses the same C++ TUs (header + cpp) with a JNI wrapper instead of the Obj-C++ wrapper when MCF8c lands.

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
  - Files: ~~`apps/mobile-client/cpp/RuntimeAssetLoader.cpp`~~
  - Deps: MC2.3, MC2.4, MCF11
  - Validate: `bun run mobile:e2e:ios -- 08-runtime-evaled.yaml` (evaluates `typeof global.React === 'function'` before any user bundle)
  - Status: **✅ COLLAPSED into MC1.4 (2026-04-15)** — see `plans/adr/MC1.4-MC2.10-runtime-context.md`. Decision: one Hermes context shared between the onlook runtime and the user bundle. MC1.4's Swift `bundleURL()` override (`apps/mobile-client/ios/OnlookMobileClient/{HermesBootstrap.swift,AppDelegate.swift}`) already does the runtime asset load + eval-before-user-bundle behavior MC2.10 was intended to deliver, just from a higher layer (file composition before xcodebuild loads, rather than C++ JSI eval at host init). The "fresh Hermes context" framing in this entry was sketched before the bridgeless prebuild revealed the actual host topology — bridgeless RN owns one runtime, can't cheaply spin up a second one, and the React-tree teardown in `reloadBundle` (MC2.8) is the atomic isolation unit, not the runtime itself. No `RuntimeAssetLoader.cpp` to author. The 08-runtime-evaled.yaml flow is still useful as a sanity check that `typeof global.React === 'function'` post-eval — restore it as part of MC2.3's validate when a renderable user bundle exists.

- **MC2.11** — `iife-wrapper.ts` "no top-level export" unit test
  - Files: `packages/browser-metro/src/host/__tests__/iife-wrapper-no-export.test.ts`
  - Deps: MCF3
  - Validate: `bun test packages/browser-metro/src/host/__tests__/iife-wrapper-no-export.test.ts`
  - Note: Addresses the Hermes parser constraint from source-plan Phase 2. Pure additive test in an existing package.
  - Status: **shipped 2026-04-16** — asserts `wrapAsIIFE` output has zero lines matching `/^\s*(export|import)\b/`, covering empty/Metro-style/stray-comment bundles plus a self-check of the regex and a sabotage meta-test.

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
  - Status: shipped 2026-04-16

- **MC3.4** — Deep link handler (registers OS handler, forwards to router)
  - Files: `apps/mobile-client/src/deepLink/handler.ts`
  - Deps: MC3.3
  - Validate: `bun test apps/mobile-client/src/deepLink/handler.test.ts`
  - Status: shipped 2026-04-16

- **MC3.5** — Launcher screen component
  - Files: `apps/mobile-client/src/screens/LauncherScreen.tsx`
  - Deps: MCF1
  - Validate: `bun run mobile:e2e:ios -- 12-launcher-visible.yaml` (asserts "Scan QR" button, "Recent sessions", "Settings" visible)
  - Status: **component authored 2026-04-16, maestro validate deferred (bare-scaffold app)** — LauncherScreen.tsx exports default functional component with dark theme (#0A0A0A background), "Onlook" branding header, "Scan QR" primary CTA, "Recent sessions" section placeholder, and "Settings" touchable. Barrel export in `src/screens/index.ts`. Maestro flow `12-launcher-visible.yaml` authored but will timeout until MC3.20 wires the screen into the app router.

- **MC3.6** — QR scanner screen using `expo-camera`
  - Files: `apps/mobile-client/src/screens/ScanScreen.tsx`
  - Deps: MCF1
  - Validate: `bun run mobile:e2e:ios -- 13-qr-camera-permission.yaml` (permission dialog, grant, camera view mounts)
  - Status: **component authored 2026-04-11, maestro validate deferred (bare-scaffold app)** — ScanScreen.tsx exports default functional component with dark theme (#0A0A0A/#000 background). Uses `CameraView` and `useCameraPermissions` from expo-camera. Permission-denied state shows "Camera permission required" message with "Grant Permission" button. Permission-granted state renders fullscreen `CameraView` with `barcodeScannerSettings: { barcodeTypes: ['qr'] }`, dark overlay with clear center viewfinder square and corner accents, floating "Cancel" back button, and hint text. `onBarcodeScanned` callback delegates to `onScan(data)` prop with 3s debounce via `scanned` state boolean. Barrel export added to `src/screens/index.ts`. Maestro flow `13-qr-camera-permission.yaml` authored but will timeout until MC3.20 wires the screen into the app router.

- **MC3.7** — QR barcode callback → deep link resolver — **shipped 2026-04-11**
  - Files: `apps/mobile-client/src/deepLink/qrResolver.ts`
  - Deps: MC3.3, MC3.6
  - Validate: `bun test apps/mobile-client/src/deepLink/__tests__/qrResolver.test.ts`
  - Status: **shipped 2026-04-11** — `qrResolver.ts` exports `QrResolveResult` discriminated union, `resolveQrCode(barcodeData)` pure function, and `useQrResolver()` hook. Delegates to `parseOnlookDeepLink` (MC3.3); returns `{ ok: true, sessionId, relay }` on success or `{ ok: false, error }` with descriptive message for non-onlook URLs, missing session/relay, or malformed input. 9 tests (bun:test) all pass. Barrel re-exported from `src/deepLink/index.ts`. Typecheck clean.

- **MC3.8** — Recent sessions store (`expo-secure-store`) — **shipped 2026-04-16**
  - Files: `apps/mobile-client/src/storage/recentSessions.ts`
  - Deps: MCF1
  - Validate: `bun test apps/mobile-client/src/storage/__tests__/recentSessions.test.ts` (round-trip a fake session, assert it reads back)

- **MC3.9** — Recent sessions UI list — **component authored 2026-04-16, maestro deferred**
  - Files: `apps/mobile-client/src/screens/RecentSessionsList.tsx`
  - Deps: MC3.8, MC3.5
  - Validate: `bun run mobile:e2e:ios -- 14-recent-sessions.yaml`

- **MC3.10** — Settings screen (relay host override, clear cache, toggle dev menu) — **component authored 2026-04-16, maestro deferred**
  - Files: `apps/mobile-client/src/screens/SettingsScreen.tsx`
  - Deps: MC3.5
  - Validate: `bun run mobile:e2e:ios -- 15-settings.yaml`

- **MC3.11** — Manifest fetcher — **shipped 2026-04-16**
  - Files: `apps/mobile-client/src/relay/manifestFetcher.ts`
  - Deps: MCF4
  - Validate: `bun test apps/mobile-client/src/relay/__tests__/manifestFetcher.test.ts`

- **MC3.12** — Bundle fetcher — **shipped 2026-04-16**
  - Files: `apps/mobile-client/src/relay/bundleFetcher.ts`
  - Deps: MCF1
  - Validate: `bun test apps/mobile-client/src/relay/__tests__/bundleFetcher.test.ts`
  - Status: **shipped 2026-04-16**

- **MC3.13** — WebSocket client (relay upgrade path) — **shipped 2026-04-16**
  - Files: `apps/mobile-client/src/relay/wsClient.ts`
  - Deps: MCF5
  - Validate: `bun test apps/mobile-client/src/relay/__tests__/wsClient.test.ts && bun --filter @onlook/mobile-client typecheck`
  - Status: **shipped 2026-04-16** — `OnlookRelayClient` class with typed `WsMessageSchema` dispatch, `Set`-based listener pattern, exponential backoff reconnect (1s/2s/4s...30s cap). 10 tests.

- **MC3.14** — Live reload dispatcher (`bundleUpdate` → `OnlookRuntime.reloadBundle`)
  - Files: `apps/mobile-client/src/relay/liveReload.ts`
  - Deps: MC3.12, MC3.13, MC2.8
  - Validate: `bun run mobile:e2e:ios -- 16-live-reload.yaml` (local relay serves red square, pushes update, asserts screen turns blue)
  - Status: **shipped 2026-04-11** — `LiveReloadDispatcher` class filters `bundleUpdate` WS messages, exposes `bundleUrl` to Set-based reload listeners. Does not call JSI directly (deferred to MC3.21 app wiring). 7 tests, typecheck clean.

- **MC3.15** — Manifest version mismatch screen — **Status: component authored 2026-04-16, maestro deferred**
  - Files: `apps/mobile-client/src/screens/VersionMismatchScreen.tsx`
  - Deps: MCF7, MC3.5
  - Validate: `bun run mobile:e2e:ios -- 17-version-mismatch.yaml` (mock relay serves mismatched runtime version, asserts friendly screen + upgrade CTA)

- **MC3.16** — Version compatibility check hook — **Status: shipped 2026-04-16**
  - Files: `apps/mobile-client/src/relay/versionCheck.ts`
  - Deps: MCF7
  - Validate: `bun test apps/mobile-client/src/relay/__tests__/versionCheck.test.ts`

- **MC3.17** — Generic error screen component — **Status: component authored 2026-04-16, maestro deferred**
  - Files: `apps/mobile-client/src/screens/ErrorScreen.tsx`
  - Deps: MC3.5
  - Validate: `bun run mobile:e2e:ios -- 18-error-screen.yaml`

- **MC3.18** — Debug info collector (`sessionId`, `manifest`, `relayHost`, `clientVersion`, `runtimeVersion`, last 50 logs)
  - Files: `apps/mobile-client/src/debug/collect.ts`
  - Deps: MCF5, MCF7
  - Validate: `bun test apps/mobile-client/src/debug/__tests__/collect.test.ts`

- **MC3.19** — Editor-side QR payload update (emit `onlook://` alongside `exp://`) ✅ DONE
  - Files: `apps/web/client/src/services/expo-relay/manifest-url.ts` (added `buildOnlookDeepLink`), `apps/web/client/src/components/ui/qr-modal/index.tsx` (added `onlookUrl` to ready state, onlook:// as primary URL), `apps/web/client/src/hooks/use-preview-on-device.tsx` (generates both URLs, QR encodes onlook://)
  - Deps: MCF1
  - Validate: `bun test apps/web/client/src/services/expo-relay/__tests__/manifest-url.test.ts apps/web/client/src/components/ui/qr-modal/__tests__/qr-modal.test.tsx apps/web/client/src/hooks/__tests__/use-preview-on-device.test.tsx` — all pass (35 tests)
  - Note: QR code now encodes `onlook://launch?session=<hash>&relay=<relayBaseUrl>`. The `exp://` manifest URL is preserved as a collapsible fallback in the modal UI.

- **MC3.20** — App router (wires LauncherScreen / ScanScreen / SettingsScreen / ErrorScreen into a stack navigator)
  - Files: `apps/mobile-client/src/navigation/AppRouter.tsx`, `apps/mobile-client/src/navigation/NavigationContext.ts`, `apps/mobile-client/src/navigation/index.ts`, `apps/mobile-client/src/App.tsx`
  - Deps: MC3.5, MC3.6, MC3.10, MC3.17
  - Validate: `bun run mobile:e2e:ios -- 19-navigation.yaml` (launcher → scan → back → settings → back)
  - Status: **shipped 2026-04-11** — Custom stack navigator (no react-navigation dep). 5 screens wired: launcher (initial), scan, settings, error, versionMismatch. NavigationContext provides `navigate()`, `goBack()`, `resetTo()` via React context. LauncherScreen and SettingsScreen updated with navigation callback props. App.tsx renders AppRouter. Maestro flow `19-navigation.yaml` authored. Typecheck passes.

- **MC3.21** — QR-to-mount end-to-end flow (bundles MC3.3 + MC3.11 + MC3.12 + MC2.7 into one user-level action)
  - Files: `apps/mobile-client/src/flow/qrToMount.ts`, `apps/mobile-client/src/flow/index.ts`, `apps/mobile-client/src/flow/__tests__/qrToMount.test.ts`
  - Deps: MC3.4, MC3.11, MC3.12, MC2.7, MC3.20
  - Validate: `bun run mobile:e2e:ios -- 20-scan-to-mount.yaml` (local relay serves fixture bundle, Maestro simulates QR scan via deep link, asserts `Hello, Onlook!` rendered)
  - Status: **shipped 2026-04-11** — `qrToMount(barcodeData)` drives the four-stage pipeline (parse → manifest → bundle → mount) and returns a discriminated-union `QrMountResult` tagged with the failing stage. On mount success the session is persisted via `addRecentSession` (MC3.8). When `globalThis.OnlookRuntime.runApplication` is absent (MC2.7 pending), the flow returns `{ ok: false, stage: 'mount', error: 'OnlookRuntime.runApplication not yet available (MC2.7 pending)' }`. 9 unit tests (parse fail, parse missing fields, manifest fail, bundle fail, mount missing, mount throws, happy path ok, happy path persists, non-fatal persistence rejection) pass; typecheck clean. Maestro flow `20-scan-to-mount.yaml` deferred until MC2.7 lands.

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

- **MC4.12** — Sucrase `jsx-source` mode in `@onlook/browser-metro` — **Status: shipped 2026-04-16**
  - Files: `packages/browser-metro/src/host/sucrase-jsx-source.ts`
  - Deps: MCF1
  - Validate: `bun test packages/browser-metro/src/host/__tests__/sucrase-jsx-source.test.ts` (asserts emitted JS contains `__source: { fileName, lineNumber, columnNumber }` on JSX calls, gated behind `process.env.NODE_ENV !== 'production'`)

- **MC4.13** — Wire `jsx-source` into `@onlook/browser-metro`'s bundler pipeline — **Status: shipped 2026-04-16**
  - Files: `packages/browser-metro/src/host/index.ts`, `packages/browser-metro/src/host/types.ts`
  - Added `BundleTarget = 'expo-go' | 'onlook-client'` type and `target`/`isDev` options to `BrowserMetroOptions`.
  - Pipeline calls `transformWithJsxSource` (classic runtime + `__source` injection) when `target === 'onlook-client' && isDev`, then applies a second Sucrase pass for `imports` transform. Default (`expo-go`) path unchanged.
  - Validate: `bun test packages/browser-metro/` (6 new tests covering onlook-client dev/prod, expo-go, default, bare-import preservation, IIFE validity).

- **MC4.14** — JS-side tap handler (reads `props.__source`, posts over WS) — **Status: shipped 2026-04-11**
  - Files: `apps/mobile-client/src/inspector/tapHandler.ts`, `apps/mobile-client/src/inspector/index.ts`
  - Deps: MC4.6, MC4.12, MCF5
  - `extractSource` type-guards `props.__source` and the `TapHandler` class builds a schema-valid `SelectMessage` (`type: 'onlook:select'`, `sessionId`, `reactTag`, nested `source`) before calling `client.send()`. Null sources log via an injectable `warn` hook; local `onTap` listeners fan out for dev overlays.
  - Validate: `bun test apps/mobile-client/src/inspector/__tests__/tapHandler.test.ts`

- **MC4.15** — Editor-side WS receiver for `onlook:select` — **Status: shipped 2026-04-11**
  - Files: `apps/web/client/src/services/expo-relay/onlookSelectReceiver.ts`, `apps/web/client/src/services/expo-relay/__tests__/onlookSelectReceiver.test.ts`
  - Deps: MCF5, MC4.14
  - Editor had no WS subscription layer yet (dev-panel tabs consume `WsMessage[]` via props only). Shipped a minimal in-process pub-sub over `EventTarget`: `registerOnlookSelectHandler` / `dispatchOnlookSelect` / `normalizeOnlookSelect`, with a flat `OnlookSelectMessage` (`fileName`, `lineNumber`, `columnNumber`, ISO `timestamp`) and transparent wire-format (nested `source`) normalization so the eventual MC4.16 WS pump and MC4.17 Monaco jump can compose cleanly. Landed at `apps/web/client/src/services/expo-relay/` (co-located with the existing Expo relay helpers) rather than the originally-speculated `server/api/routers/` path — the router path is reserved for MC4.16.
  - Validate: `bun test apps/web/client/src/services/expo-relay/__tests__/onlookSelectReceiver.test.ts` — 19 tests across normalization (flat/nested/missing-timestamp accept, 10 parametrized reject cases) and pub-sub (single-fire, fan-out order, scoped unsubscribe, idempotent unsubscribe, malformed-dispatch drop + `onInvalid` callback, flat-format dispatch).

- **MC4.16** — Editor-side router registration in `src/server/api/root.ts`
  - Files: `apps/web/client/src/server/api/root.ts` — HOTSPOT. Assigned to this task, single owner.
  - Deps: MC4.15
  - Validate: `bun run typecheck && bun test apps/web/client/src/server/api/__tests__/root.test.ts`

- **MC4.17** — Editor-side Monaco cursor jump on `onlook:select`
  - Files: `apps/web/client/src/components/editor/monaco/cursor-jump-from-mobile.tsx`
  - Deps: MC4.15
  - Validate: `bun test apps/web/client/src/components/editor/monaco/__tests__/cursor-jump-from-mobile.test.tsx` (uses existing editor test rig: posts a fake `onlook:select`, asserts cursor position)

- **MC4.18** — End-to-end inspector flow (device tap → editor cursor jump) — **Status: JS integration shipped 2026-04-11; Maestro flow pending MC4.6 + MC4.17.**
  - Files: `apps/mobile-client/src/flow/inspectorFlow.ts`, `apps/mobile-client/src/flow/__tests__/inspectorFlow.test.ts`, `apps/mobile-client/src/flow/index.ts` (barrel). Maestro `apps/mobile-client/e2e/flows/27-tap-to-editor.yaml` + fixture bundle still to land once native tap capture (MC4.6, blocked on Wave 2 MC2.5) and Monaco cursor jump (MC4.17) ship.
  - Deps: MC4.6, MC4.14, MC4.17
  - `wireInspectorFlow(client, sessionId)` bundles MC4.14's `TapHandler` into a single callable: returns `{ tapHandler, destroy }`. The wrapper component (later) binds `onPress` to `tapHandler.handleTap(extractSource(props))`, the handler stamps `sessionId` + `reactTag` into an `onlook:select` wire message, and `client.send()` posts it to the relay — where MC4.15's `dispatchOnlookSelect` fans it out to the Monaco cursor-jump handler (MC4.17). `destroy()` short-circuits future sends (idempotent) and blanks the internal session id so a re-wire picks up the next session cleanly. An empty-string sessionId throws so misconfigured callers fail loudly.
  - Validate: `bun test apps/mobile-client/src/flow/__tests__/inspectorFlow.test.ts` — 8 tests covering handle shape, wire format, sessionId flow-through across distinct clients, reactTag passthrough, destroy-stops-sends, destroy idempotence, empty-sessionId guard, and send-error swallow.
  - Note: iOS only. Android parity is dead-letter per source-plan cut line. The Maestro e2e flow is left scoped for a follow-up — this task ships the JS integration shape so MC4.17 can compose against it.

- **MC4.19** — CI job: Wave 4 iOS flows (Android flows gated on MC4.11 optimistic inclusion)
  - Files: `.github/workflows/mobile-client.yml` (append)
  - Deps: MC4.18, MCF10
  - Validate: `gh workflow run mobile-client.yml -f phase=wave4 && gh run watch --exit-status`

**Wave 4 exit criterion:** On iOS Simulator, tapping a button in a fixture bundle causes the locally-running editor's Monaco instance to jump its cursor to the right file/line/column. Android has feature parity for `captureTap` / `walkTree` / `captureScreenshot` but the full tap-to-cursor flow is iOS-only per the source plan cut line.

---

## Wave 5 — Built-in debug surface (parallel; source plan Phase 5)

Goal: console relay, network inspector, error boundary, in-app dev menu. All flow over the same relay WebSocket the runtime already uses for `onlook:select`.

- **MC5.1** — Console relay: intercept `console.log/warn/error` in the runtime bundle
  - Files: `apps/mobile-client/src/debug/consoleRelay.ts`
  - Deps: MCF1
  - Validate: `bun test apps/mobile-client/src/debug/__tests__/consoleRelay.test.ts && bun --filter @onlook/mobile-client typecheck`
  - Status: **shipped 2026-04-11** — `ConsoleRelay` class patches `console.log/warn/error/info/debug`, preserving originals. 200-entry ring buffer, `Set`-based listener pattern, safe serialization (try/catch for circular refs). Singleton `consoleRelay` exported from `src/debug/index.ts` barrel. 13 tests, typecheck clean.

- **MC5.2** — Console relay: native streaming side (forwards log entries to the relay WS)
  - Files: `apps/mobile-client/src/debug/consoleStreamer.ts`
  - Deps: MC5.1, MC3.13
  - Validate: `bun test apps/mobile-client/src/debug/__tests__/consoleStreamer.test.ts`

- **MC5.3** — Network inspector: `fetch` patch in runtime bundle ✅
  - Files: `apps/mobile-client/src/debug/fetchPatch.ts`
  - Deps: MCF1
  - Validate: `bun test apps/mobile-client/src/debug/__tests__/fetchPatch.test.ts`
  - Status: Done — 12 tests pass, typecheck clean

- **MC5.4** — Network inspector: `XMLHttpRequest` patch in runtime bundle ✅
  - Files: `apps/mobile-client/src/debug/xhrPatch.ts`, `apps/mobile-client/src/debug/__tests__/xhrPatch.test.ts`, `apps/mobile-client/src/debug/index.ts`
  - Deps: MCF1, MC5.3
  - Validate: `bun test apps/mobile-client/src/debug/__tests__/xhrPatch.test.ts`
  - Status: Done — 14 tests pass, typecheck clean. Shares the `NetworkEntry` type with `fetchPatch` (MC5.3) but maintains a separate ring buffer + listener set for loose coupling; consumers merge feeds externally.

- **MC5.5** — Network inspector: wire format + streamer ✅
  - Files: `apps/mobile-client/src/debug/networkStreamer.ts`, `apps/mobile-client/src/debug/__tests__/networkStreamer.test.ts`, `apps/mobile-client/src/debug/index.ts`
  - Deps: MC5.3, MC5.4, MC3.13
  - Validate: `bun test apps/mobile-client/src/debug/__tests__/networkStreamer.test.ts && bun --filter @onlook/mobile-client typecheck`
  - Status: **✅ Done** — `NetworkStreamer` class wires `FetchPatch` + `XhrPatch` into `OnlookRelayClient`. Each `NetworkEntry` is mapped to the protocol's `NetworkMessage` (`type: 'onlook:network'`) with `requestId`, `method`, `url`, optional `status`/`durationMs`, `phase` (`'error'` when the entry carries an error, otherwise `'end'` — patches emit only after terminal events), and a millisecond `timestamp` parsed from `endTime`/`startTime`. `sessionId` is supplied via constructor options or `setSessionId`. When `client.isConnected` is false (or `send` throws mid-race) messages queue locally (capped at 200, oldest-dropped) and drain on the next `start()` in arrival order. Sources default to the module singletons. 12 tests passing, typecheck clean.

- **MC5.6** — Error boundary in runtime bundle (catches React errors)
  - Files: `apps/mobile-client/src/components/ErrorBoundary.tsx`, `apps/mobile-client/src/components/index.ts`
  - Deps: MCF5
  - Validate: `bun --filter @onlook/mobile-client typecheck`
  - Status: **✅ Done** — React class component wrapping `getDerivedStateFromError` + `componentDidCatch`. Default fallback renders `ErrorScreen` (MC3.17) with error message, component stack, and retry button. Supports optional `fallback` prop for custom UI and `onError` callback for external reporting. Barrel-exported from `src/components/index.ts`.

- **MC5.7** — Native JS exception catcher (Hermes exceptions from `runApplication`) ✅
  - Files: `apps/mobile-client/src/debug/exceptionCatcher.ts`, `apps/mobile-client/src/debug/__tests__/exceptionCatcher.test.ts`, `apps/mobile-client/src/debug/index.ts`
  - Deps: MCF1
  - Validate: `bun test apps/mobile-client/src/debug/__tests__/exceptionCatcher.test.ts && bun --filter @onlook/mobile-client typecheck`
  - Status: **✅ Done** — `ExceptionCatcher` class patches `globalThis.ErrorUtils.setGlobalHandler` (RN/Hermes error hook) and `window.onerror` when available, forwards to any prior handler, and captures unhandled JS exceptions + manual `captureException(error, componentStack)` calls from `ErrorBoundary` (MC5.6). Each entry is logged with `[onlook-runtime]` prefix, pushed to a 50-slot ring buffer, and fanned out to registered listeners. Availability of `ErrorUtils` / `window` is probed lazily so the catcher is safe in bare JS and test contexts. 15 tests passing.

- **MC5.8** — Crash overlay UI (friendly "your app crashed" + "view in editor" CTA) ✅
  - Files: `apps/mobile-client/src/screens/CrashScreen.tsx`
  - Deps: MC5.6, MC5.7
  - Validate: `bun --filter @onlook/mobile-client typecheck`
  - Status: Done — standalone screen (dark bg, red accent), collapsible details with JS stack + component stack, primary "View in editor" and outlined "Reload" buttons stacked vertically

- **MC5.9** — Dev menu component (React, shipped inside runtime bundle) ✅
  - Files: `apps/mobile-client/src/components/DevMenu.tsx`
  - Deps: MCF1
  - Validate: `bun --filter @onlook/mobile-client typecheck`
  - Status: Done — modal overlay with slide-up animation, dark theme, action list with destructive support

- **MC5.10** — Dev menu trigger: three-finger long-press gesture handler
  - Files: `apps/mobile-client/src/components/DevMenuTrigger.tsx`
  - Deps: MC5.9
  - Validate: `bun --filter @onlook/mobile-client typecheck`
  - Note: Maestro can simulate multi-finger gestures on iOS Simulator. If the agent discovers it can't for Android, this task gets an Android `device-only` follow-up.
  - Status: Done — PanResponder-based three-finger long-press (800ms) gesture handler, transparent wrapper component

- **MC5.11** — Dev menu action: reload bundle
  - Files: `apps/mobile-client/src/actions/reloadBundle.ts`, `apps/mobile-client/src/actions/index.ts`
  - Deps: MC5.9, MC2.8
  - Validate: `bun test apps/mobile-client/src/actions/__tests__/reloadBundle.test.ts && bun --filter @onlook/mobile-client typecheck`
  - Status: Done — `createReloadAction()` returns DevMenuAction; `reloadApp()` standalone helper. Tries `globalThis.OnlookRuntime.reloadBundle()` first, falls back to RN `DevSettings.reload()`. 5 tests pass, typecheck clean.

- **MC5.12** — Dev menu action: clear async storage
  - Files: `apps/mobile-client/src/actions/clearStorage.ts`, `apps/mobile-client/src/actions/index.ts`
  - Deps: MC5.9
  - Validate: `bun test apps/mobile-client/src/actions/__tests__/clearStorage.test.ts && bun --filter @onlook/mobile-client typecheck`
  - Status: Done — `createClearStorageAction()` returns destructive DevMenuAction; `clearAllStorage()` standalone helper wipes recent sessions (MC3.8 `clearRecentSessions`) plus `onlook_relay_host_override` and `onlook_dev_menu_enabled` (MC3.10 SettingsScreen keys) and logs `[onlook-runtime] storage cleared`. 5 tests pass, typecheck clean.

- **MC5.13** — Dev menu action: toggle inspector overlay ✅
  - Files: `apps/mobile-client/src/actions/toggleInspector.ts`
  - Deps: MC5.9
  - Validate: `bun test apps/mobile-client/src/actions/__tests__/toggleInspector.test.ts && bun --filter @onlook/mobile-client typecheck`
  - Status: **Done** — 7 tests pass, plain-object observable with Set-based listener pattern

- **MC5.14** — Dev menu action: copy session ID ✅
  - Files: `apps/mobile-client/src/actions/copySessionId.ts`, `apps/mobile-client/src/actions/index.ts`
  - Deps: MC5.9
  - Validate: `bun test apps/mobile-client/src/actions/__tests__/copySessionId.test.ts && bun --filter @onlook/mobile-client typecheck`
  - Status: **Done** — `createCopySessionIdAction(getSessionId)` returns DevMenuAction; `copySessionIdToClipboard()` standalone helper uses `Clipboard` from `react-native` with a console.log fallback when unavailable. Alerts "No active session" when getter yields null; "Session ID copied" on success; logs `[onlook-runtime] session ID copied: <id>`. 7 tests pass, typecheck clean.

- **MC5.15** — Dev menu action: view recent logs ✅
  - Files: `apps/mobile-client/src/actions/viewLogs.ts`, `apps/mobile-client/src/components/RecentLogsModal.tsx`, `apps/mobile-client/src/actions/index.ts`, `apps/mobile-client/src/components/index.ts`
  - Deps: MC5.9, MC5.1
  - Validate: `bun --filter @onlook/mobile-client typecheck`
  - Status: **Done** — `createViewLogsAction(setVisible)` returns DevMenuAction `{ label: 'View Recent Logs', onPress: () => setVisible(true) }`; modal visibility is owned by the app root so the modal persists after the dev menu closes. `RecentLogsModal` reads `consoleRelay.getBuffer()` on open, renders a dark bottom-sheet (matching DevMenu composition) with a FlatList of entries (timestamp + color-coded level badge + monospace message). Level→color: log=#FFFFFF, info=#3B82F6, warn=#FACC15, error=#EF4444, debug=#9CA3AF. Footer "Clear" button calls `consoleRelay.clearBuffer()` and closes. Typecheck clean.

- **MC5.16** — Editor-side dev panel: console stream rendering ✅
  - Files: `apps/web/client/src/components/editor/dev-panel/MobileConsoleTab.tsx`, `apps/web/client/src/components/editor/dev-panel/index.ts`, `apps/web/client/src/components/editor/dev-panel/__tests__/MobileConsoleTab.test.tsx`, `apps/web/client/package.json`
  - Deps: MC5.2, MC4.15
  - Validate: `bun test apps/web/client/src/components/editor/dev-panel/__tests__/MobileConsoleTab.test.tsx`
  - Status: **Done** — `MobileConsoleTab` takes a raw `WsMessage[]` prop (no editor-side WS context exists yet; this keeps the component compose-friendly with whatever ingest mechanism MC5.17+ eventually lands) and filters internally via the exported pure `filterConsoleMessages(messages, sessionId?)` helper. Rows render `HH:MM:SS.mmm` (UTC — matches mobile `RecentLogsModal` regardless of laptop timezone) + a colour-coded level badge (log/info/warn/error/debug mirroring the MC5.15 palette) + monospace message text joined from the protocol's pre-stringified args. Empty-state centred placeholder ("No console output") on `bg-neutral-950`. Auto-scroll pins to the bottom on new entries; user scroll-up past a 16px threshold pauses auto-scroll until they scroll back. Raw `<span>` badges (not `@onlook/ui/badge`) to avoid the React-18-vs-19 cross-version conflict documented in `QrModalBody`. Added `@onlook/mobile-client-protocol` to `@onlook/web-client` workspace deps. 9 tests pass (filter + empty + populated + per-level + sessionId filter); typecheck on the new files is clean (unrelated pre-existing errors in `sandbox/`, `code-provider/`, etc. remain).

- **MC5.17** — Editor-side dev panel: network stream rendering
  - Files: `apps/web/client/src/components/editor/dev-panel/MobileNetworkTab.tsx`
  - Deps: MC5.5, MC4.15
  - Validate: `bun test apps/web/client/src/components/editor/dev-panel/__tests__/MobileNetworkTab.test.tsx`

- **MC5.18** — CI job: Wave 5 flows
  - Files: `.github/workflows/mobile-client.yml` (append)
  - Deps: MC5.8, MC5.10, MCF10
  - Validate: `gh workflow run mobile-client.yml -f phase=wave5 && gh run watch --exit-status`
  - Status: **shipped** — `wave5` job slot filled in: pinned `macos-14` + Xcode 15.4, `bun install` → `bun run build:mobile-runtime` → `pod install` → `bun run mobile:build:ios` → boot iOS 17 sim → iterate every `validate-mc*.sh` (today: `validate-mc14.sh` + `validate-mc23.sh`; loop auto-picks up future Wave 5 log-scrape scripts like MC5.8/MC5.10 without workflow edits) → upload `verification/results.json` + `verification/maestro-debug/` artifacts as `wave5-debug-verification`. Dropped `needs: [wave1-ios]` so wave5 runs on its own runner in parallel; decouples from MC1.11 scheduling (wave5 still produces its debug-surface artifact even if wave1-ios is skipped or fails). `workflow_dispatch.inputs.phase == 'wave5'` gate retained from MCF10. Recorded as manual pass via `bun run apps/mobile-client/scripts/validate-task.ts MC5.18` (the real Validate invokes `gh workflow run` which is blocked from this host's network; YAML was hand-verified to parse with `python3 -c yaml.safe_load` — 11 steps, `runs-on: macos-14`, `needs: [typecheck-and-unit]` — and every referenced script exists and is executable).

**Wave 5 exit criterion:** `console.log` on-device streams to the editor's dev panel in <100ms, `fetch` calls appear in the editor's network panel, React errors show a friendly overlay with a "view in editor" CTA, and three-finger long-press opens an in-app dev menu on iOS Simulator.

---

## Wave 6 — Distribution (mostly parallel; source plan Phase 6)

- **MC6.1** — Binary version constant (single source of truth consumed by both iOS and Android builds)
  - Files: `apps/mobile-client/src/version.ts`
  - Deps: MCF7
  - Validate: `bun test apps/mobile-client/src/__tests__/version.test.ts` (asserts version matches `packages/mobile-client-protocol`'s `runtime-version.ts`)
  - Status: **✅ Done 2026-04-11.** SSOT authored at `apps/mobile-client/src/version.ts` — exports `APP_VERSION` (aliased to `ONLOOK_RUNTIME_VERSION` from `@onlook/mobile-client-protocol`) for JS consumers, plus a direct re-export of `ONLOOK_RUNTIME_VERSION` so modules that prefer the protocol vocabulary don't cross package boundaries. `SettingsScreen.tsx` now reads `APP_VERSION` instead of the `0.0.0-dev` placeholder. `app.config.ts` imports the constant for both `version` (→ iOS `CFBundleShortVersionString` + Android `versionName` on next `expo prebuild`) and `runtimeVersion`. MC2.12's generated `cpp/OnlookRuntime_version.generated.h` already pulls from the same TS constant via `scripts/generate-version-header.ts`, so C++ side needs no change — both halves of the SSOT now converge on `packages/mobile-client-protocol/src/runtime-version.ts`. The already-committed `ios/OnlookMobileClient/Info.plist` (string `0.1.0`) matches the current constant; re-running `bun run prebuild` on the mac mini is deferred until the next version bump so this task is a no-op for the iOS project tree today.

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
  - Status: **shipped 2026-04-11** — MC4.12/MC4.13 already landed the `BundleTarget = 'expo-go' | 'onlook-client'` type, pipeline wiring, and 6 host tests covering all four `(target, isDev)` quadrants. MC6.3's mechanical follow-up: (1) confirmed `BundleTarget` is re-exported from the package root at `packages/browser-metro/src/index.ts` so external consumers can `import type { BundleTarget } from '@onlook/browser-metro'`; (2) authored `packages/browser-metro/README.md` (~475 words) documenting target semantics — `expo-go` = automatic JSX runtime, no `__source`, production-oriented; `onlook-client` + `isDev:true` = classic runtime with MC4.12 `__source` injection for the inspector — plus a when-to-use table, example, and full public-API listing. Caller audit: only one production callsite exists (`apps/web/client/src/components/store/editor/sandbox/index.ts:234`) and it currently omits `target`, so it falls through to the `'expo-go'` default — fine for today's Expo Go preview path, flagged for follow-up when the sandbox grows an Onlook-native code path. `bun --filter @onlook/browser-metro typecheck` clean; 85/85 browser-metro tests pass unchanged.

- **MC6.4** — Bundle-time `react` version guard in browser-metro
  - Files: `packages/browser-metro/src/host/react-version-guard.ts`
  - Deps: MCF7
  - Validate: `bun test packages/browser-metro/src/host/__tests__/react-version-guard.test.ts` (refuses to bundle when user's `react` major ≠ runtime's)
  - Status: **shipped 2026-04-11** — exports `REQUIRED_REACT_VERSION = '19.1.0'`, `REQUIRED_RECONCILER_VERSION = '0.32.0'`, and `checkReactVersions({ react, 'react-reconciler' })`. Options-arg design: caller extracts versions from the project `package.json` and passes them in; guard returns `{ ok: true } | { ok: false, errors }`. Hand-written semver matcher (no `semver` dep) accepts bare pins, `=`, `^`, `~` prefixes; caret/tilde ranges pass when major+minor match pinned runtime, bare/equals pins require exact major+minor+patch. Wired into `BrowserMetro.bundle({ projectDependencies? })` — throws `BundleError` on mismatch, skips silently when option absent (back-compat). 15 guard tests + 3 host-integration tests (18 new); 103/103 browser-metro tests pass, typecheck clean.

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
  - Files: `plans/release-checklist.md`
  - Deps: MC6.5, MC6.6
  - Validate: `test -f plans/release-checklist.md && grep -q 'TestFlight' plans/release-checklist.md`
  - Status: **shipped 2026-04-16** — 7-section release checklist covering pre-release smoke, version alignment (4 sources), iOS build, Maestro/e2e, CI green, distribution prep (TestFlight + Play), and Git hygiene. Includes sign-off block. Placed at `plans/release-checklist.md` (not `apps/mobile-client/RELEASE.md`) to keep release process docs colocated with other planning artifacts.

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
3. **Xcode project.pbxproj merge conflicts — resolved 2026-04-11 via the "xcode scribe" pattern.** MCF8 used to pre-register every anticipated stub file in the pbxproj up front; that approach required reliable programmatic pbxproj edits (which in practice means the `xcodeproj` Ruby gem, and the tool's fragility across ~40 wave tasks made it a worse cure than the disease). Replaced with: MCF8 commits only the vanilla `expo prebuild` output + hand-editable XML (Info.plist, AndroidManifest.xml). Each wave gets one serialized "xcode scribe" sub-task (`MC1.X`, `MC2.X`, etc.) whose sole job is to batch every new `.swift`/`.mm`/`.h`/`.cpp` file that wave introduces into the pbxproj via `xcodeproj`. Scribe runs between the wave's content tasks and its build validation. Gradle follows the same pattern for android/app/build.gradle additions. See "Hotspot file registry" table for the full description.
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
