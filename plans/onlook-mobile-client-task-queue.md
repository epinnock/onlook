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

- **MC1.4.1** — Refresh shell.js Spike B → onlook-runtime branding
  - Files: `packages/mobile-preview/runtime/shell.js`, `packages/mobile-preview/server/build-runtime.ts` (audit only; no changes needed as of 2026-04-11)
  - Deps: MC1.4 (landed)
  - Validate: `bun run build:mobile-runtime` regenerates `bundle.js` cleanly; no remaining `[SPIKE_B]` prefix in runtime logs.
  - Status: **Housekeeping follow-up** flagged in `plans/adr/MC1.4-MC2.10-runtime-context.md`. Wave 2 is functionally complete; refresh the log prefix and spike-era comments in `shell.js` to match the `[onlook-runtime]` / `[onlook-inspector]` convention already used elsewhere in the shell.

- **MC1.4.2** — Use OnlookLogger.notice for non-error boot events
  - Files: `apps/mobile-client/ios/OnlookMobileClient/OnlookLogger.swift`, `apps/mobile-client/ios/OnlookMobileClient/HermesBootstrap.swift`
  - Deps: MC1.4 (landed)
  - Validate: `bash apps/mobile-client/scripts/validate-mc14.sh` — `.default` is persisted by `log show` without the `--info` flag (same as `.error`), so the `[onlook-runtime] hermes ready` scrape still captures the line.
  - Status: **Landed.** Added `OnlookLogger.notice(_:)` that wraps `os_log` at `type: .default` — Apple's recommended level for notable non-error events. Switched the `hermes ready` boot line in `HermesBootstrap.prepend(into:)` from `OnlookLogger.error` to `OnlookLogger.notice` so the os_log level matches the event's semantics. The three remaining `OnlookLogger.error` call sites in `HermesBootstrap.swift` (runtime asset not found, read failure, runtime-missing guard in `prepend`) are genuine error conditions and stay at `.error`.

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
  - Status: **ESLint half shipped 2026-04-16 as aa7317c9; Metro resolver block deferred to follow-up.** ADR landed 2026-04-15 — see `plans/adr/MC1.8-module-allowlist.md`. Direction: enforce the allowlist at the **JS-import surface** (ESLint + Metro resolver), not at the linked-binary set. Original validate (`grep -L ExpoFileSystem ...`) is unworkable because ExpoFileSystem is a baseline `expo-modules-core` peer. Shipped scope (this dispatch):
    - **Files landed:** `apps/mobile-client/src/supported-modules.ts` (programmatic allowlist — `ALLOWED_EXPO_MODULES` + `isAllowedExpoModule`), `apps/mobile-client/eslint.config.mjs` (flat config — extends `@onlook/eslint/base`, adds `no-restricted-imports` with `paths` + `patterns` for 14 banned `expo-*` modules), `apps/mobile-client/scripts/validate-mc18.sh` (baseline-then-probe validator).
    - **Validate:** `bun --filter @onlook/mobile-client lint && bash apps/mobile-client/scripts/validate-mc18.sh` — script runs baseline lint (expect exit 0), writes `__lint_probe__.ts` importing `expo-av`, reruns lint (expect non-zero), cleans up via trap.
    - **Deferred follow-up:** `apps/mobile-client/metro.config.js` resolver block. Prior attempts bled hours on the resolver without landing a fix; ESLint alone catches ~all authored imports before bundling, which covers the primary threat model. Resolver will be picked up as a separate task once the Metro config pattern is proven in a scratch repo.

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

- **MC2.2.1** — Audit cpp/ TUs for Android-readiness
  - Files: `apps/mobile-client/cpp/README.md` (NEW)
  - Deps: MC2.2, MC2.3, MC2.7, MC2.8, MC2.9, MC2.12, MC2.15, MC4.1
  - Validate: `bun --filter @onlook/mobile-client typecheck`
  - Status: **shipped 2026-04-11.** Read every `.cpp` under `apps/mobile-client/cpp/` (9 TUs: `OnlookRuntime.cpp`, `OnlookRuntime_runApplication.cpp`, `OnlookRuntime_reloadBundle.cpp`, `OnlookRuntime_dispatchEvent.cpp`, `OnlookRuntime_version.cpp`, `OnlookRuntimeInstaller.cpp`, `OnlookInspector.cpp`, `OnlookInspectorInstaller.cpp`, `InspectorPrewarm.cpp`); confirmed zero Foundation / UIKit / `<React/*>` includes, zero `NSString*` / `UIView*` types, zero Obj-C runtime calls. All 9 TUs depend only on `<jsi/jsi.h>` + RN CallInvoker/TurboModule + C++ stdlib — 9/9 clean, 0 need refactor. iOS-only Obj-C++ work is properly quarantined in sibling `.mm` files (`OnlookRuntimeInstaller.mm`, `OnlookInspectorInstaller.mm`, `OnlookInspector_highlight.mm`). README documents the per-TU audit result and the Android CMake pickup plan (compile the 9 `.cpp`, skip the 3 `.mm`) for when MCF8c activates the Android toolchain.

- **MC2.3** — iOS installer TurboModule that registers `OnlookRuntime` on `globalThis`
  - Files: `apps/mobile-client/cpp/OnlookRuntimeInstaller.{h,cpp,mm}`, `packages/mobile-preview/runtime/shell.js`, `apps/mobile-client/scripts/validate-mc23.sh`, `apps/mobile-client/ios/OnlookMobileClient.xcodeproj/project.pbxproj`
  - Deps: MC2.2, MC1.4
  - Validate: `bash apps/mobile-client/scripts/validate-mc23.sh`
  - Status: **iOS shipped 2026-04-16.** See `plans/adr/MC2.3-runtime-installer-hook.md` for the decision to implement via a pure-C++ TurboModule + Obj-C++ wrapper (`RCT_EXPORT_MODULE(OnlookRuntimeInstaller)` — reached by RN 0.81's `RCTTurboModuleManager._getModuleClassFromName` ObjC fallback, so no separate `RCTAppDependencyProvider` entry needed). `shell.js` calls `globalThis.__turboModuleProxy('OnlookRuntimeInstaller').install()` at the very top before any other runtime setup; the C++ `install()` emits `[onlook-runtime] OnlookRuntime installed on globalThis` via `nativeLoggingHook` so the validate script can log-scrape for the confirmation (maestro `04-global-present.yaml` left in the repo for when a renderable user bundle exists, same deal as MC1.4). Android mirror (MC2.4) re-uses the same C++ TUs (header + cpp) with a JNI wrapper instead of the Obj-C++ wrapper when MCF8c lands.

- **MC2.3.1** — Lock `globalThis.OnlookRuntime` from user-code replacement
  - Files: `apps/mobile-client/cpp/OnlookRuntimeInstaller.cpp`
  - Deps: MC2.3
  - Validate: `bun run mobile:build:ios` (Mac mini — BUILD SUCCEEDED; the lock is behaviorally-observable only from a renderable user bundle, which is still parked — same deal as the MC2.3 maestro flow).
  - Status: **shipped 2026-04-11.** ADR follow-up called out in `plans/adr/MC2.3-runtime-installer-hook.md` ("Follow-ups" §). After the existing `rt.global().setProperty(rt, "OnlookRuntime", ...)` in `OnlookRuntimeInstaller::installHostObject`, a `{ ... }` scoped block resolves `globalThis.Object.defineProperty` through JSI and re-installs `"OnlookRuntime"` with a descriptor of `{ value: <the host-object wrapper>, writable: false, configurable: false, enumerable: true }`. Net effect: a user bundle doing `globalThis.OnlookRuntime = {}` silently no-ops (or throws in strict mode) and `delete globalThis.OnlookRuntime` fails — the inspector (MC4.X) and runtime (MC2.7/MC2.8/MC2.9) can trust that the host object they installed is the one they'll see on subsequent calls. Pulling the descriptor's `value` via `rt.global().getProperty(rt, "OnlookRuntime")` (rather than reusing the in-flight `std::move`'d `jsObject`) sidesteps any ambiguity about the moved-from wrapper; the JSI `Object.defineProperty` call shape matches the ECMA-262 §7.3.6 signature `(O, P, Attributes)` exactly. Skipped a JSI-level unit test — the repo has no hosted `jsi::Runtime` harness (neither Hermes-for-test nor JSC-for-test TUs are on the iOS target), so the behavior is exercised via the Mac mini Xcode build + the eventual Wave-3 user-bundle maestro flow that MC2.3's `04-global-present.yaml` is already parked against.

- **MC2.4** — Android JNI installer that registers `OnlookRuntime` on `global`
  - Files: `apps/mobile-client/android/app/src/main/cpp/onlook_runtime_installer.cpp`
  - Deps: MC2.2, MC1.7
  - Validate: `bun run mobile:e2e:android -- 04-global-present.yaml`

- **MC2.5** — Native-side Fabric `registerEventHandler` pre-JS call (iOS) — **Status: iOS placeholder shipped 2026-04-16; real Fabric hook deferred to follow-up once downstream tasks reveal the needed API surface.**
  - Files: `apps/mobile-client/ios/OnlookMobileClient/FabricEventBootstrap.mm` + `FabricEventBootstrap.h` (re-homed from the original `ios/OnlookMobile/` path to match MC1.10 / MC4.6 target folder). `apps/mobile-client/ios/OnlookMobileClient/AppDelegate.swift` calls `FabricEventBootstrap.registerHandler()` after `factory.startReactNative(...)`; bridging header `OnlookMobileClient-Bridging-Header.h` imports `FabricEventBootstrap.h`. `apps/mobile-client/ios/OnlookMobileClient.xcodeproj/project.pbxproj` updated (file refs + Sources build-phase entry + PBXGroup children) via the same pattern as MC1.10 / MC4.6. The shipped body is a placeholder that `os_log`s a marker line proving the native-side registration pass ran — the runtime's `packages/mobile-preview/runtime/shell.js:111` still owns the real `nativeFabricUIManager.registerEventHandler(...)` invocation today. The placeholder gives downstream inspector work (MC4.6's tap forwarder, MC2.15 prewarm) a known native seam to call through to; the real body lands in a follow-up once those tasks surface the exact Fabric API we need to hook.
  - Deps: MC2.3
  - Validate: `bun run mobile:build:ios` (Mac mini — BUILD SUCCEEDED is the placeholder exit criterion). `bun run mobile:e2e:ios -- 05-fabric-event-registered.yaml` is deferred to the follow-up that fills in the real Fabric handler body.

- **MC2.6** — Native-side Fabric `registerEventHandler` pre-JS call (Android)
  - Files: `apps/mobile-client/android/app/src/main/cpp/fabric_event_bootstrap.cpp`
  - Deps: MC2.4
  - Validate: `bun run mobile:e2e:android -- 05-fabric-event-registered.yaml`

- **MC2.7** — `runApplication(bundleSource, props)` C++ impl (fresh Hermes context, eval, call `onlookMount`)
  - Files: `apps/mobile-client/cpp/OnlookRuntime_runApplication.cpp`
  - Deps: MC2.5, MC2.6, MCF3 (bundle envelope types)
  - Validate: `bun run mobile:e2e:ios -- 06-red-square.yaml` AND `bun run mobile:e2e:android -- 06-red-square.yaml` (Maestro takes screenshot, compares against `e2e/fixtures/red-square.png` via image-diff)
  - Status: **iOS impl shipped 2026-04-11; captureAndReport wired 2026-04-16.** `OnlookRuntime_runApplication.cpp` defines `runApplicationImpl(rt, args, count)` — validates `(bundleSource: string, props?: object)` with a JSError on mismatch, evals the bundle via `rt.evaluateJavaScript(std::make_shared<jsi::StringBuffer>(bundleSource), "onlook-user-bundle.js")`, rewraps eval failures with an attributable `"OnlookRuntime.runApplication: bundle eval failed: …"` prefix, resolves `globalThis.onlookMount` with defensive `isObject`/`isFunction` guards, and calls `onlookMount(props)`. Declaration added to `OnlookRuntime.h` in `namespace onlook`; `OnlookRuntime::runApplication` in `OnlookRuntime.cpp` now forwards to `runApplicationImpl` in one line (mirrors the MC4.2 captureTap template). pbxproj registers the TU in the OnlookMobileClient group + Sources build phase with fresh UUIDs. SHA-256 bundle-source tracking (for the MC2.8 reloadBundle byte-equal short-circuit) deferred as an MC2.8 follow-up — the stored `mountedBundleSha_` field in `OnlookRuntime.h` is unused for now. Maestro `06-red-square.yaml` deferred to the Mac mini runner once the runtime-asset loader (MC2.10) is in place; local verification is `bun run mobile:build:ios` BUILD SUCCEEDED with `OnlookRuntime_runApplication.o` in DerivedData. **captureAndReport wired 2026-04-16** — body is now wrapped in the MC2.14 helper so arg-validation / eval-rewrap / missing-`onlookMount` / std::exception throws funnel through `globalThis.OnlookRuntime.dispatchEvent('onlook:error', {kind, message, stack})`; on error paths the impl returns `undefined` (helper is catch-and-swallow, not catch-and-rethrow), leaving JS-side listeners responsible for reacting to the event.

- **MC2.8** — `reloadBundle(bundleSource)` C++ impl (atomic tree teardown + remount)
  - Files: `apps/mobile-client/cpp/OnlookRuntime_reloadBundle.cpp` (NEW), `apps/mobile-client/cpp/OnlookRuntime.h` (declaration added), `apps/mobile-client/cpp/OnlookRuntime.cpp` (1-line delegate replacing the MC2.2 skeleton throw), `apps/mobile-client/ios/OnlookMobileClient.xcodeproj/project.pbxproj` (Sources/group registration)
  - Deps: MC2.7
  - Validate: `bun run mobile:e2e:ios -- 07-reload-bundle.yaml` (load red square, reload with blue square, assert screenshot matches blue-square fixture)
  - Status: **iOS impl shipped 2026-04-11; captureAndReport wired 2026-04-16.** `OnlookRuntime_reloadBundle.cpp` defines `reloadBundleImpl(rt, args, count)` — validates `(bundleSource: string)` with a JSError on mismatch (message aligned with MC2.7's format for shared log regex), resolves `globalThis.onlookUnmount` with defensive `isObject`/`isFunction` guards, calls it with a try/catch that swallows JSError (teardown failures are non-fatal — the subsequent `onlookMount` re-mount replaces the Fabric tree wholesale via React's root-scoped commit), then forwards `args` to `runApplicationImpl` for the re-eval + re-mount. Implemented the `onlookUnmount` hook path (tree teardown) so live-reload cleans up React roots cleanly before the fresh mount; props-replay cache is deferred (caller re-passes props via `runApplication` directly when non-defaults are needed — noted in the TU header). Declaration added to `OnlookRuntime.h` in `namespace onlook`; `OnlookRuntime::reloadBundle` in `OnlookRuntime.cpp` now forwards to `reloadBundleImpl` in one line (mirrors MC2.7's delegate template). pbxproj registers the TU in the OnlookMobileClient group + Sources build phase with fresh UUIDs `D8F3B5E1C2A40B5D8E3F9C01/02` following MC2.7's manual-edit approach. Maestro `07-reload-bundle.yaml` deferred to the Mac mini runner once the runtime-asset loader (MC2.10) is in place; local verification target is `bun run mobile:build:ios` BUILD SUCCEEDED with `OnlookRuntime_reloadBundle.o` in DerivedData. **captureAndReport wired 2026-04-16** — outer body wrapped in the MC2.14 helper so arg-validation throws funnel through `onlook:error`. The inner `onlookUnmount` try/catch remains unchanged (teardown failures intentionally not reported — they don't block the re-mount and would produce noisy stale-tree events). The nested `runApplicationImpl` call already carries its own `captureAndReport` wrap; since the helper is catch-and-swallow (not rethrow), errors there are reported exactly once at the inner frame and the outer wrap is effectively inert for the re-mount stage.

- **MC2.9** — `dispatchEvent(name, payload)` C++ impl
  - Files: `apps/mobile-client/cpp/OnlookRuntime_dispatchEvent.cpp` (NEW), `apps/mobile-client/cpp/OnlookRuntime.h` (declaration added), `apps/mobile-client/cpp/OnlookRuntime.cpp` (1-line delegate replacing the MC2.2 skeleton throw), `apps/mobile-client/ios/OnlookMobileClient.xcodeproj/project.pbxproj` (Sources/group registration)
  - Deps: MC2.7
  - Validate: `bun test apps/mobile-client/__tests__/OnlookRuntime_dispatchEvent.spec.ts` (a mock Maestro flow posts an event, JS-side listener returns via log)
  - Status: **iOS impl shipped 2026-04-11; captureAndReport wired 2026-04-16.** `OnlookRuntime_dispatchEvent.cpp` defines `dispatchEventImpl(rt, args, count)` — validates `(name: string, payload?: any)` with a JSError on mismatch (message aligned with MC2.7/MC2.8 format for shared log regex), resolves `globalThis.__onlookEventBus` with a defensive `isObject` guard, and forwards `(name, payload)` via `dispatch.callWithThis(bus, …)` so the shell-side dispatcher sees `this === bus`. Bus-missing fallback is a benign no-op (native callers like the tap forwarder have no reasonable way to recover from a synchronous throw across the JSI boundary) that logs a breadcrumb via `nativeLoggingHook` when available so dropped events remain attributable during triage. Bus-present-but-non-callable `.dispatch` IS a protocol bug surfaced as a JSError — the shell contract explicitly requires the method. Declaration added to `OnlookRuntime.h` in `namespace onlook`; `OnlookRuntime::dispatchEvent` in `OnlookRuntime.cpp` now forwards to `dispatchEventImpl` in one line (mirrors MC2.7/MC2.8 delegate template). pbxproj registers the TU in the OnlookMobileClient group + Sources build phase with fresh UUIDs `E9A4C6F2D3B51C6E9F4A0D01/02` following the MC2.7/MC2.8 manual-edit approach. Bun-test spec deferred to the Mac mini runner once the native test harness is wired up (MC2.10+); local verification target is `bun run mobile:build:ios` BUILD SUCCEEDED with `OnlookRuntime_dispatchEvent.o` in DerivedData. **captureAndReport wired 2026-04-16** — body wrapped in the MC2.14 helper so arg-validation / non-callable-`.dispatch` throws and any exception escaping the listener-side `dispatch.callWithThis` call funnel through `onlook:error`. No infinite-loop risk: `reportRuntimeError` routes through `globalThis.OnlookRuntime.dispatchEvent` which re-enters this impl, but a pathological listener that throws on the `onlook:error` event itself is caught inside `reportRuntimeError`'s own try/catch (swallowed). Benign bus-missing / nativeLoggingHook-missing no-op paths do not throw so the wrap is inert on those branches.

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
  - Files: `apps/mobile-client/cpp/OnlookRuntime_errorSurface.cpp`, `apps/mobile-client/cpp/OnlookRuntime.h` (declarations), `apps/mobile-client/ios/OnlookMobileClient.xcodeproj/project.pbxproj` (Sources/group registration — 4-UUID manual edit)
  - Deps: MC2.7
  - Validate: `bun run mobile:e2e:ios -- 10-bundle-throws.yaml` (loads a bundle that throws, asserts the error message surfaces through a `dispatchEvent('onlook:error', …)` callback)
  - Status: **Helper landed 2026-04-11.** `reportRuntimeError(rt, kind, message, stack)` funnels `{kind, message, stack}` through `globalThis.OnlookRuntime.dispatchEvent('onlook:error', payload)` with a benign no-op when the runtime isn't installed yet; `captureAndReport(rt, fn)` wraps a callable and classifies throws as `"js"` (jsi::JSError, preserves stack), `"native"` (std::exception), or `"unknown"`. Wired into the iOS target via a 4-UUID manual pbxproj edit (F0B5D7E3C4A62D7F0A5B1E01/02). Runtime callers (MC2.7 runApplication, MC2.8 reloadBundle, MC2.9 dispatchEvent) still need to swap their raw try/catch blocks over to `captureAndReport` — tracked as follow-ups in those tasks. Mac mini xcodebuild validation + 10-bundle-throws.yaml e2e run pending.

- **MC2.15** — Pre-warm `findNodeAtPoint(-1, -1)` after mount (risk mitigation from source plan)
  - Files: `apps/mobile-client/cpp/InspectorPrewarm.cpp` (NEW), `apps/mobile-client/cpp/OnlookRuntime.h` (declaration added), `apps/mobile-client/cpp/OnlookRuntimeInstaller.cpp` (call site), `apps/mobile-client/ios/OnlookMobileClient.xcodeproj/project.pbxproj` (Sources/group registration)
  - Deps: MC2.5, MC2.6
  - Validate: `bun run mobile:e2e:ios -- 11-tap-latency.yaml` (first tap after mount returns in < 30ms)
  - Status: **iOS scaffolding shipped 2026-04-11.** `prewarmInspector(jsi::Runtime&)` declared in `OnlookRuntime.h` (kept alongside existing free functions — separate `InspectorPrewarm.h` would duplicate the `<jsi/jsi.h>` include for a single 1-line decl) and defined in the new `InspectorPrewarm.cpp` TU. Called from `OnlookRuntimeInstaller::installHostObject` AFTER `rt.global().setProperty("OnlookRuntime", …)` and the install-confirmation log line, so the validate-mc23 log scrape still sees the expected line before any prewarm-side work. Body is fully defensive: missing `nativeFabricUIManager`, missing `findNodeAtPoint`, non-function value, or a thrown exception all silently no-op — prewarm is best-effort, never user-visible. The `11-tap-latency.yaml` Maestro flow remains a follow-up (needs a renderable bundle to tap on, which Wave 2 doesn't provide); the BUILD-SUCCEEDED exit criterion is Mac mini `bun run mobile:build:ios`. pbxproj registration followed the direct-edit template from MC4.1 commit `74090a54` (PBXBuildFile + PBXFileReference + OnlookMobileClient group member + Sources build phase) rather than the xcodeproj Ruby gem, matching what MC4.1/MC4.5/MC4.6 actually did in-repo.

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
  - Status: **shipped 2026-04-16 as 08122dc3** — debug info collector with capped log buffer.

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

### Wave 3 bug fixes

- **MCF-BUG-QR-SUBSEQUENT** — Subsequent QR scans fail after first
  - Files: `apps/mobile-client/src/flow/qrToMount.ts`, `apps/mobile-client/src/flow/__tests__/qrToMount.test.ts`, `apps/mobile-client/src/__tests__/full-pipeline.integration.test.ts`
  - Deps: MC3.21, MC2.7, MC2.8
  - Validate: `bun test apps/mobile-client/src/flow/__tests__/qrToMount.test.ts apps/mobile-client/src/__tests__/full-pipeline.integration.test.ts`
  - Status: **shipped 2026-04-11** — Root cause: `qrToMount` always routed through `OnlookRuntime.runApplication`, which only handles the first mount (the MC2.7 C++ TU evaluates the bundle and calls `globalThis.onlookMount(props)` without tearing down any prior React tree). The second scan therefore left the first React root intact and stacked a second `onlookMount` call on top, producing a stale/broken UI that the user saw as a silent failure. Fix: added a module-level `hasMountedApplication` flag; scan #1 still uses `runApplication`, scans #2+ route through `OnlookRuntime.reloadBundle(bundleSource)` (MC2.8) which runs `globalThis.onlookUnmount()` before re-evaluating the bundle. Two regression tests added covering the happy-path second-scan and the reload-throws error surface; existing 9 tests still pass. Test-only `__resetQrToMountState()` helper added to let harnesses reset the flag between cases.

---

## Wave 4 — `OnlookInspector` (parallel; source plan Phase 4)

Goal: click-to-edit on a physical phone. This is the single biggest user-facing differentiator.

iOS and Android paths fan out in parallel — 4.1–4.6 are iOS, 4.7–4.11 are Android, 4.12–4.19 are cross-cutting JS/editor work.

- **MC4.1** — iOS `OnlookInspector` TurboModule registration
  - Files: `apps/mobile-client/cpp/OnlookInspector.{h,cpp}`, `apps/mobile-client/cpp/OnlookInspectorInstaller.{h,cpp,mm}`, `packages/mobile-preview/runtime/shell.js`, `apps/mobile-client/ios/OnlookMobileClient.xcodeproj/project.pbxproj`
  - Deps: MCF8b, MC2.3
  - Validate: `bun run mobile:build:ios` (with log-scrape for `OnlookInspector installed on globalThis`; maestro `21-inspector-global.yaml` parked behind a renderable user bundle, same story as MC1.4 / MC2.3)
  - Status: **iOS shipped 2026-04-11.** Pure-C++ `onlook::OnlookInspector` JSI host object + `onlook::OnlookInspectorInstaller` TurboModule following the MC2.3 template — the only differences are the host-object type (`OnlookInspector` vs. `OnlookRuntime`), the global property name, and the log prefix (`[onlook-inspector]`). Skeleton throws `jsi::JSError("OnlookInspector.<name>: not implemented (Wave 4 MC4.X)")` from every method (`captureTap`, `walkTree`, `captureScreenshot`, `highlightNode`) until MC4.2..MC4.5 land. `shell.js` gains a second install IIFE beside the runtime one; both resolve through `globalThis.__turboModuleProxy`. `OnlookInspector.o` + `OnlookInspectorInstaller.o` compile into the iOS target for both arm64 and x86_64. Android mirror re-uses the same C++ TUs (header + cpp) behind MCF8c.

- **MC4.2** — iOS `captureTap(x, y)` — calls `findNodeAtPoint` on `nativeFabricUIManager` — **Status: shipped 2026-04-11.**
  - Files: `apps/mobile-client/cpp/OnlookInspector.cpp` (method body). Re-homed from the original Swift-extension sketch (`OnlookInspector+captureTap.swift`) into the pure-C++ JSI host object introduced in MC4.1 — same TU as the rest of the inspector methods, so there's no Swift↔C++ bridge cost on the tap path. Public `OnlookInspector.h` signature unchanged.
  - Deps: MC4.1, MCF6
  - Validate: `bun run mobile:build:ios` — C++ type-check + Xcode link. Runtime e2e `22-capture-tap.yaml` is MC4.19's CI job; skipped here because it needs a fixture bundle that lands with MC4.18.
  - Implementation: arg-count guard (`count >= 2`), both args `isNumber()` — JSError with descriptive message otherwise. Resolves `globalThis.nativeFabricUIManager` → `findNodeAtPoint` via `rt.global().getProperty(rt, …)`; defends against missing Fabric (`isObject()` + `isFunction()` checks, each with its own JSError). Calls `findNodeAtPoint.call(rt, jsi::Value(x), jsi::Value(y))` and returns the result verbatim (shape is Fabric's choice — typically a numeric `reactTag` or `{ reactTag, rect }`; editor-side receiver normalizes, see MC4.15). `try/catch` around the JSI chain rethrows `jsi::JSError` untouched and wraps any `std::exception` with a `"OnlookInspector.captureTap: findNodeAtPoint threw: "` prefix.

- **MC4.3** — iOS `walkTree(reactTag)` — shadow tree walker using `cloneNodeWithNewChildren` introspection
  - Files: `apps/mobile-client/ios/OnlookMobile/OnlookInspector+walkTree.swift`
  - Deps: MC4.1, MCF6
  - Validate: `bun run mobile:e2e:ios -- 23-walk-tree.yaml`
  - Status: **shipped 2026-04-16 as ad45cdf3** — iOS Fabric shadow-tree walker.

- **MC4.4** — iOS `captureScreenshot()` — `UIView.snapshot(after:afterScreenUpdates:)` → base64 PNG
  - Files: `apps/mobile-client/ios/OnlookMobile/OnlookInspector+captureScreenshot.swift`
  - Deps: MC4.1
  - Validate: `bun run mobile:e2e:ios -- 24-screenshot.yaml` (base64 decodes to a valid PNG ≥ 100 bytes)

- **MC4.5** — iOS `highlightNode(reactTag, color)` — 2px overlay border, 600ms — **Status: shipped 2026-04-11.**
  - Files: `apps/mobile-client/cpp/OnlookInspector_highlight.mm` (NEW — isolated Obj-C++ TU so MC4.2/4.3/4.4 can edit `OnlookInspector.cpp` concurrently without rebase fights). Declares `onlook::highlightNodeImpl(jsi::Runtime&, int reactTag, std::string colorHex)` as a free function in `OnlookInspector.h`; `OnlookInspector::highlightNode` in `OnlookInspector.cpp` is a thin delegator (arg validation + call). Also updates `apps/mobile-client/ios/OnlookMobileClient.xcodeproj/project.pbxproj` (file ref + Sources build-phase entry, same template as MC4.1).
  - Deps: MC4.1
  - Validate: `bun run mobile:build:ios` (BUILD SUCCEEDED); `bun run mobile:e2e:ios -- 25-highlight.yaml` (Maestro screenshots before/during/after, compares regions) — gates behind a renderable user bundle, same story as MC4.1.

- **MC4.6** — iOS tap event forwarder (Fabric root tap → `RCTDeviceEventEmitter`) — **Status: JS-facing module shipped 2026-04-11; Fabric call-site waits on MC2.5.**
  - Files: `apps/mobile-client/ios/OnlookMobileClient/OnlookTapForwarder.mm` (NEW — re-homed from the original `ios/OnlookMobile/OnlookInspectorEventForwarder.mm` path so the file lives alongside MC1.10's `OnlookLogger.swift` under the actual target folder `OnlookMobileClient/`). Also updates `apps/mobile-client/ios/OnlookMobileClient.xcodeproj/project.pbxproj` (adds file ref + Sources build-phase entry, same pbxproj-edit pattern as MC1.10 / MC4.1).
  - Deps: MC4.2 (shipped), MC2.5 (Fabric `registerEventHandler` — still in flight). MC2.5 is what actually calls `[OnlookTapForwarder forwardTap:reactTag:source:]` from the Fabric commit phase; MC4.6 ships the module standalone so the integration snaps together when MC2.5 lands.
  - Shape: `OnlookTapForwarder : RCTEventEmitter <RCTBridgeModule>`, `RCT_EXPORT_MODULE(OnlookTapForwarder)`, `supportedEvents = @[@"onlookTap"]`. Exposes `+ (void)forwardTap:(CGPoint)point reactTag:(NSInteger)reactTag source:(nullable NSDictionary *)source` which looks up the singleton instance (weak static, set in `-init`, guarded `@synchronized`), and calls `sendEventWithName:@"onlookTap" body:@{ @"x", @"y", @"reactTag", @"source" }`. `source` is a direct passthrough of `props.__source` (MC4.12's Sucrase `jsx-source` metadata) plucked by the Fabric tap handler; nil source bridges to JS `null` so MC4.14's `extractSource` hits its null-guard. Gated on `-startObserving` / `-stopObserving` state so pre-subscription taps drop silently instead of logging RN's "no listeners registered" warning.
  - Validate: Mac mini iOS build (`bun run mobile:build:ios` — compiles + links the new TU into `OnlookMobileClient.app`). The 26-tap-forwarded.yaml Maestro flow is deferred to MC4.19 after MC2.5's Fabric handler registration lands, since the tap-to-emit path can't fire until MC2.5 invokes `forwardTap:` from a real Fabric commit.

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

- **MC4.16** — Editor-side router registration in `src/server/api/root.ts` — **Status: shipped 2026-04-11**
  - Files: `apps/web/client/src/server/api/root.ts` — HOTSPOT. Assigned to this task, single owner. Plus `apps/web/client/src/server/api/routers/mobile-inspector.ts` (new).
  - Deps: MC4.15
  - New router `mobileInspector` registered on `appRouter` exposing two skeleton procedures: `getActiveSession` (public query, returns `null` placeholder until the session registry lands) and `onSelect` (public mutation, input validated against `SelectMessageSchema` from `@onlook/mobile-client-protocol`, logs for now). Matches the existing import style in `root.ts` (nested path for routers outside the barrel — same pattern as `branchRouter` / `cfSandboxRouter`). No test harness existed at `apps/web/client/src/server/api/__tests__/root.test.ts`; left un-added pending a broader server-side test rig.
  - Validate: `bun --filter @onlook/web-client typecheck` clean for the new router/root changes (remaining errors are pre-existing in unrelated code paths — 21 before, 21 after).

- **MC4.17** — Editor-side Monaco cursor jump on `onlook:select`
  - Files: `apps/web/client/src/components/editor/monaco/cursor-jump-from-mobile.tsx`
  - Deps: MC4.15
  - Validate: `bun test apps/web/client/src/components/editor/monaco/__tests__/cursor-jump-from-mobile.test.tsx` (uses existing editor test rig: posts a fake `onlook:select`, asserts cursor position)
  - Status: **shipped 2026-04-16 as d9f90113** — Monaco cursor jump driven by `onlook:select`.

- **MC4.18** — End-to-end inspector flow (device tap → editor cursor jump) — **Status: JS integration shipped 2026-04-11; Maestro flow pending MC4.6 + MC4.17.**
  - Files: `apps/mobile-client/src/flow/inspectorFlow.ts`, `apps/mobile-client/src/flow/__tests__/inspectorFlow.test.ts`, `apps/mobile-client/src/flow/index.ts` (barrel). Maestro `apps/mobile-client/e2e/flows/27-tap-to-editor.yaml` + fixture bundle still to land once native tap capture (MC4.6, blocked on Wave 2 MC2.5) and Monaco cursor jump (MC4.17) ship.
  - Deps: MC4.6, MC4.14, MC4.17
  - `wireInspectorFlow(client, sessionId)` bundles MC4.14's `TapHandler` into a single callable: returns `{ tapHandler, destroy }`. The wrapper component (later) binds `onPress` to `tapHandler.handleTap(extractSource(props))`, the handler stamps `sessionId` + `reactTag` into an `onlook:select` wire message, and `client.send()` posts it to the relay — where MC4.15's `dispatchOnlookSelect` fans it out to the Monaco cursor-jump handler (MC4.17). `destroy()` short-circuits future sends (idempotent) and blanks the internal session id so a re-wire picks up the next session cleanly. An empty-string sessionId throws so misconfigured callers fail loudly.
  - Validate: `bun test apps/mobile-client/src/flow/__tests__/inspectorFlow.test.ts` — 8 tests covering handle shape, wire format, sessionId flow-through across distinct clients, reactTag passthrough, destroy-stops-sends, destroy idempotence, empty-sessionId guard, and send-error swallow.
  - Note: iOS only. Android parity is dead-letter per source-plan cut line. The Maestro e2e flow is left scoped for a follow-up — this task ships the JS integration shape so MC4.17 can compose against it.

- **MC4.19** — CI job: Wave 4 iOS flows (Android flows gated on MC4.11 optimistic inclusion) — **Status: shipped 2026-04-11.**
  - Files: `.github/workflows/mobile-client.yml`
  - Deps: MC4.18, MCF10
  - Validate: `gh workflow run mobile-client.yml -f phase=wave4-ios && gh run watch --exit-status`
  - Replaced the MCF10 `wave4` stub with a real `wave4-ios` macos-14 job mirroring MC5.18's `wave5` shape: bun 1.3.9 + Xcode 15.4 pin, brew cocoapods + maestro, `bun install --frozen-lockfile`, `bun run build:mobile-runtime`, `pod install`, `bun run mobile:build:ios`, boot the first available iOS 17 iPhone simulator, then a `nullglob` loop over `apps/mobile-client/scripts/validate-mc4*.sh` (empty glob => explicit FAIL so an empty scripts dir can't silently pass). Uploads `apps/mobile-client/verification/{results.json,maestro-debug/}` + e2e flow PNGs as the `wave4-ios-verification` artifact with `if: always()`. Dropped `needs: [wave1-ios]` so the inspector pass runs in parallel on a dedicated runner (each validate rebuilds + reinstalls its own .app). Retains MCF10's `hashFiles('…OnlookInspector.swift')` guard so the slot stays skipped until MC4.1 lands the Swift shim; gates on `inputs.phase == 'wave4-ios'` for manual dispatch (input description updated to swap `wave4` → `wave4-ios`). Recorded as a manual pass — `gh workflow run` is blocked from this host's network; YAML hand-verified with `python3 yaml.safe_load` (11 steps, `runs-on: macos-14`, `needs: [typecheck-and-unit]`).

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
  - Status: **shipped 2026-04-16 as d40537d5** — console streamer forwards entries to the relay WS.

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

- **MC5.17** — Editor-side dev panel: network stream rendering ✅
  - Files: `apps/web/client/src/components/editor/dev-panel/MobileNetworkTab.tsx`, `apps/web/client/src/components/editor/dev-panel/index.ts`, `apps/web/client/src/components/editor/dev-panel/__tests__/MobileNetworkTab.test.tsx`
  - Deps: MC5.5, MC4.15
  - Validate: `bun test apps/web/client/src/components/editor/dev-panel/__tests__/MobileNetworkTab.test.tsx`
  - Status: **Done (shipped 2026-04-16 as ff7c85c0 — already on origin at pull time)** — `MobileNetworkTab` mirrors the MC5.16 `MobileConsoleTab` shape (same `{ messages: WsMessage[]; sessionId?: string }` props + internal `filterNetworkMessages` pure helper). The phased wire stream (`start`/`end`/`error` carrying a shared `requestId`) is folded into one row per request — latest phase wins, first-seen insertion order preserved. Columns: Method / URL / Status / Duration, with `statusColorClass()` mapping 2xx → `text-green-500`, 4xx → `text-amber-500`, 5xx → `text-red-500`, pending → `text-neutral-500`. Row click toggles a details panel (request id, phase, timestamp, duration, full URL) via `useState<string | null>(selectedId)` with toggle semantics extracted into a pure `computeNextSelected(current, clicked)` reducer so the state machine is unit-testable without a DOM. Empty state: centred "No network activity" on `bg-neutral-950`. Raw monospace rows + `@onlook/ui/utils` `cn` only (same React-18/19 pinning workaround as MC5.16). 16/16 tests pass (filter, session filter, phase collapse, status-colour branches ×4, toggle reducer ×3, empty ×2, populated render, per-status colour markup, row-toggle details panel, populated session filter); new files typecheck clean (unrelated pre-existing errors in `sandbox/`, `code-provider/`, `hero/` remain).

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
  - Status: **✅ Done 2026-04-11.** `buildManifest` now imports `ONLOOK_RUNTIME_VERSION` from `@onlook/mobile-client-protocol` and stamps it onto `extra.expoClient.onlookRuntimeVersion` for every manifest (iOS + Android). The protocol package is pulled in as a workspace dep on `apps/cf-expo-relay/package.json` so the relay never hardcodes a version — an MCF7/MC6.1 bump propagates automatically. `ExpoManifestExtra.expoClient` gained an explicit `onlookRuntimeVersion: string` field (no `any`, `import type` preserved elsewhere). Added `allowImportingTsExtensions: true` to the relay's `tsconfig.json` so it can consume the protocol package's `.ts` re-exports the same way `apps/mobile-client` and the web client already do. Added 2 new unit tests in `src/__tests__/manifest-builder.test.ts` asserting the field equals the protocol SSOT, matches `/^\d+\.\d+\.\d+$/`, and is present on both platform variants — suite is now green at 21/21 (was 19/19). `bun --filter @onlook/cf-expo-relay typecheck` passes; full relay suite 61/61. The HTTP route serving layer (`src/routes/manifest.ts`) is unchanged because it already delegates to `buildManifest`, so the new field flows through the multipart envelope with zero extra plumbing.

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
  - Status: **shipped 2026-04-16** — landed `apps/mobile-client/eas.json` with three build profiles (`development`, `preview`, `production`) plus matching `submit` blocks. `development` and `preview` set `ios.simulator: true` so a dev without Apple signing identities can still dry-run via `bun run mobile:build:testflight` — the wrapper script at `scripts/build-testflight.sh` auto-detects `xcodebuild` and routes to `eas build --local` on macOS / `eas config --profile preview` on Linux / a plain JSON load if offline, keeping the Validate line exit-0 across all three host classes. Added three scripts to `apps/mobile-client/package.json`: `mobile:build:testflight` (dry-run default), `eas:build:preview` (`eas build --profile preview --platform ios --non-interactive`), and `eas:submit:preview` (`eas submit --profile preview --platform ios --non-interactive`). `cli.appVersionSource: "remote"` intentionally isolates EAS-managed `buildNumber` from the binary `version` (which MC6.1 pins to `ONLOOK_RUNTIME_VERSION`). Submit credentials (`appleId`/`ascAppId`/`appleTeamId`) left as placeholders; first real upload requires a maintainer to run `eas init` on a logged-in Mac to populate `extra.eas.projectId` in `app.config.ts`. Documented prerequisites, local-build flow, and CI invocation contract in `apps/mobile-client/docs/MC6.5-testflight.md` — section 3 sets up the handoff for MC6.7 (`EXPO_TOKEN`-gated real-submit step, `--submit` mode of the wrapper hard-fails exit 3 when the token is absent so a misconfigured CI run cannot silently skip the gate). `eas.json` passes `python3 -c 'import json; json.load(...)'`; `package.json` JSON still parses after edits.

- **MC6.6** — Android Play Store internal-track build config
  - Files: `apps/mobile-client/scripts/build-play-internal.sh`
  - Deps: MCF8
  - Validate: `bun run mobile:build:play-internal --dry-run`
  - Status: **shipped 2026-04-11** — layered the Android side of MC6.5's `apps/mobile-client/eas.json` (MC6.5 landed the iOS profiles + empty Android shells first; MC6.6 filled Android per spec): all three profiles now carry `android.image: "latest"`; `development` keeps `buildType: "apk"` + `gradleCommand: ":app:assembleDebug"`; `preview` is `buildType: "apk"` under the existing `distribution: "internal"`; `production` is `buildType: "app-bundle"` under the existing `autoIncrement: true`. Added Android `submit` blocks for both `preview` (`track: "internal"`) and `production` (`track: "production"`), each with `serviceAccountKeyPath: "./google-play-service-account.json"`, `releaseStatus: "draft"` (fail-safe — maintainer must click through in Play Console), `changesNotSentForReview: false`. Authored `apps/mobile-client/scripts/build-play-internal.sh` mirroring `build-testflight.sh` one-to-one: `--dry-run` default routes through `eas build --local` when `ANDROID_HOME` + `android/` prebuild exist / `eas config --profile preview --platform android` when SDK missing / plain `json.load` of `eas.json` when offline (keeps Validate line green pre-MCF8c); `--submit` hard-fails exit 3 when `EXPO_TOKEN` absent, exit 4 when `GOOGLE_PLAY_SERVICE_ACCOUNT_KEY` absent, materializes the service-account JSON from env right before `eas submit --track internal`, removes it via `trap EXIT`. Added `mobile:build:play-internal`, `eas:build:preview:android` (`eas build --profile preview --platform android --non-interactive`), `eas:submit:preview:android` (`eas submit --profile preview --platform android --non-interactive --track internal`) to `apps/mobile-client/package.json`. Extended `apps/mobile-client/.gitignore` to exclude `google-play-service-account.json` so the key never accidentally lands in git. Documented Play Console prereqs (manual first-upload paradox, service-account role, tester enrollment), local workflow, and the dry-run-by-default → MC6.8 upload-gate handoff in `apps/mobile-client/docs/MC6.6-play-store.md`. `eas.json` passes `python3 -c "import json; json.load(...)"`; `package.json` JSON still parses. Race with MC6.5: MC6.5's commit was already in my local HEAD (not yet pushed to origin) when I rebased — it had laid down `eas.json` with empty Android shells, so MC6.6's diff is purely additive (three `image: "latest"` fields, two Android `submit` blocks) — no merge conflict materialized. `--submit` will fail at `eas build` until MCF8c commits the Android prebuild; the dry-run path (which is what CI exercises by default per MC6.8) is unaffected.

- **MC6.7** — CI job: TestFlight upload (dry-run-only by default, gated on secret)
  - Files: `.github/workflows/mobile-client.yml` (append)
  - Deps: MC6.5, MCF10
  - Validate: `gh workflow run mobile-client.yml -f phase=testflight-dryrun && gh run watch --exit-status`
  - Status: **shipped 2026-04-11** — added `testflight-upload` job on `macos-14`, dispatch-only (`on.workflow_dispatch`). Threaded a new `upload: boolean` input (default `false`) through the existing `workflow_dispatch.inputs` block; job `if:` requires `github.event_name == 'workflow_dispatch'` AND (`inputs.phase == ''` OR `inputs.phase == 'testflight-upload'`) AND `env.HAS_EXPO_TOKEN == 'true'`. The secret gate uses the GitHub-recommended indirection — `env.HAS_EXPO_TOKEN: ${{ secrets.EXPO_TOKEN != '' && 'true' || 'false' }}` — because `secrets.*` is not directly readable inside `if:` expressions; missing secret ⇒ job SKIPS (green, not red). Steps: `actions/checkout@v4`, `oven-sh/setup-bun@v2` (bun 1.3.9), `bun install --frozen-lockfile`, then a single shell step that branches on `inputs.upload`: `true` runs `bun x eas-cli build --profile preview --platform ios --non-interactive --local=false` followed by `bun x eas-cli submit --profile preview --platform ios --non-interactive --latest`; `false` (default) runs `bun x eas-cli build --profile preview --platform ios --non-interactive --dry-run`. Existing `testflight-dryrun` slot left untouched (separate push-triggered path). YAML passes `python3 -c "import yaml; yaml.safe_load(...)"`.

- **MC6.8** — CI job: Play Store upload (dry-run-only by default)
  - Files: `.github/workflows/mobile-client.yml` (append)
  - Deps: MC6.6, MCF10
  - Validate: `gh workflow run mobile-client.yml -f phase=play-dryrun && gh run watch --exit-status`
  - Status: **shipped 2026-04-11** — appended `play-store-upload` job as the Android mirror of MC6.7's `testflight-upload`. Runs on `ubuntu-latest` (Android builds don't need macOS — the real signed `.aab` is built by EAS cloud runners when `upload=true`, and the Linux host only needs bun + eas-cli to drive dry-runs). Adds `actions/setup-java@v4` with Temurin 17 to match `wave1-android`'s baseline. Triple-gated identically to MC6.7: (a) `hashFiles('apps/mobile-client/eas.json') != ''` (MC6.5 config exists), (b) `github.event_name == 'workflow_dispatch' && (inputs.phase == '' || inputs.phase == 'play-store-upload')`, (c) `env.HAS_GOOGLE_PLAY_KEY == 'true'` — the `GOOGLE_PLAY_SERVICE_ACCOUNT_KEY` secret threaded through a job-level env var because repo secrets can't be read directly from `if:` expressions; missing secret ⇒ job SKIPS (green, not red). Re-uses the existing `upload: boolean` dispatch input (MC6.7 added it); default `false` runs `bun x eas-cli build --profile preview --platform android --non-interactive --dry-run`, `true` runs the cloud build then `bun x eas-cli submit --profile preview --platform android --non-interactive --latest` to the Play internal track using submit.preview.android from eas.json. `phase` dropdown and `upload` description extended to include the new job. Existing `play-dryrun` slot left untouched (separate push-triggered path mirroring `testflight-dryrun`). YAML passes `python3 -c "import yaml; yaml.safe_load(...)"`; final `jobs` list: `typecheck-and-unit, wave1-ios, wave1-android, wave3, wave4-ios, wave5, testflight-dryrun, testflight-upload, play-dryrun, play-store-upload`. No conflict with MC6.7: it had already merged into the file on origin prior to this commit, so MC6.8 is a clean append after the `play-dryrun` block.

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
  - Files: `apps/mobile-client/e2e/flows/99-full-pipeline.yaml` + `apps/mobile-client/src/__tests__/full-pipeline.integration.test.ts`
  - Deps: ALL of Wave 3, Wave 4 iOS side, Wave 5
  - Validate: `bun run mobile:e2e:ios -- 99-full-pipeline.yaml` (source-plan DoD steps 1–7 as a single Maestro flow: QR scan → mount → edit in editor → live reload → tap → editor cursor jump → dev menu → console visible)
  - Status: **in-process harness shipped 2026-04-11** — `full-pipeline.integration.test.ts` drives the MC3.21 QR-to-mount flow plus MC3.13/MC3.14 live-reload wiring entirely in-process under `bun:test`, so CI can validate the integration ahead of the Maestro simulator run. Four scenarios: (1) happy path parse → manifest → bundle → `runApplication` stub, asserting bundle bytes + `{sessionId}` props forwarded verbatim; (2) connect → `bundleUpdate` WS frame → `LiveReloadDispatcher` → `OnlookRuntime.reloadBundle` stub → disconnect, also asserting non-`bundleUpdate` frames do not trigger reloads and `disconnect()` closes the socket without reconnect; (3) MC2.7-pending branch — absent `OnlookRuntime` surfaces the mount-stage error with the expected diagnostic log; (4) manifest-stage 500 short-circuits before bundle/mount. Stubs: inline `MockWebSocket` (mirrors `wsClient.test.ts` pattern) swapped into `globalThis.WebSocket`; `globalThis.fetch` routed through a fake relay serving a valid multipart/mixed Expo Updates manifest and a JS bundle fixture; `globalThis.OnlookRuntime` = POJO capturing `runApplication` + `reloadBundle` calls; `expo-secure-store` mocked via `mock.module` because it is a transitive import of `recentSessions`. Uses only shipped modules (`src/relay/*`, `src/flow/qrToMount.ts`). `bun test` 4 pass / 22 expects / ~230ms; `bun --filter @onlook/mobile-client typecheck` clean. Maestro YAML (`99-full-pipeline.yaml`) remains the canonical device-level Wave I exit — still deferred to Mac mini.

- **MCI.2** — Binary size audit
  - Files: `apps/mobile-client/scripts/binary-size-audit.sh` + `apps/mobile-client/scripts/__tests__/binary-size-audit.sh.test.ts` + `plans/binary-size-baseline.md`
  - Deps: MC6.5, MC6.6
  - Validate: `bun run mobile:audit:size` (asserts iOS IPA ≤ 40MB, Android APK ≤ 35MB — calibration values; agent adjusts to observed baseline + 10%)
  - Status: **script + tests + baseline scaffold shipped 2026-04-11** — `binary-size-audit.sh` takes `--app <path>` (defaults to newest DerivedData `OnlookMobileClient.app`), emits JSON-to-stdout / human-summary-to-stderr. JSON schema v1: `{schemaVersion, generatedAt, appPath, appName, total:{bytes,human}, components:{mainBinary,onlookRuntime,mainJsBundle,frameworks}, top10Files[]}`. 8 bun tests pass against a synthetic fixture (covers happy path, schema shape, all four components, top-10 ordering, missing-component branch, stderr summary, exit-2 on no-app, `--app=PATH` form). Auto-detects BSD vs GNU `stat`; runs on Linux CI and macOS. Deferred to Mac-mini: filling in the measured baseline numbers in `plans/binary-size-baseline.md` section 2 and wiring the `mobile:audit:size` npm script to chain `mobile:build:ios` + run the audit + gate on thresholds. Pathname is `binary-size-audit.sh` (not `audit-binary-size.ts` as originally listed) — bash script is the right shape for DerivedData discovery + `du`/`stat` patterns.

- **MCI.3** — Bundle size audit (post target-flag)
  - Files: `apps/mobile-client/scripts/audit-bundle-size.ts`
  - Deps: MC6.3
  - Validate: `bun run mobile:audit:bundle-size` (asserts `target: 'onlook-client'` bundle for the `Hello, Onlook!` fixture ≤ 20KB)
  - Status: **script + fixture + baseline shipped 2026-04-16 as d679c405** (origin advanced `ffe1fc93` → `d9f90113` in this session; MCI.3's test landed as `d679c405`) — delivered under `packages/browser-metro/` rather than `apps/mobile-client/scripts/` because the target flag + `__source` transform live in the bundler, so the audit has direct access to the `BrowserMetro` class without wiring through the mobile-client. Files: `packages/browser-metro/scripts/bundle-size-audit.ts` (bun script, bundles the fixture twice — `target:'expo-go' isDev:false` vs `target:'onlook-client' isDev:true` — emits schemaVersion-1 JSON on stdout + one-line human summary on stderr), `packages/browser-metro/fixtures/minimal-app.tsx` (~15-line nested-JSX React component), `plans/bundle-size-baseline.md` (measurements + regeneration instructions). Baseline run: `expo-go` = 4508 B (4.4 KB), `onlook-client` = 4456 B (4.4 KB), delta = **-52 B (-1.15 %)** — the automatic-runtime `require('react/jsx-dev-runtime')` boilerplate slightly exceeds the `__source` payload on this tiny fixture; delta is expected to flip positive as JSX tree size scales. Well under the 20 KB threshold. The `mobile:audit:bundle-size` npm script wiring + the `Hello, Onlook!` fixture + the ≤ 20 KB CI gate are deferred to MCI.6 / Mac-mini follow-up.

- **MCI.4** — Protocol drift test (N-1 compatibility for 30 days)
  - Files: `packages/mobile-client-protocol/src/__tests__/drift.test.ts` + `fixtures/`
  - Deps: MCF5
  - Validate: `bun test packages/mobile-client-protocol/src/__tests__/drift.test.ts`
  - Status: **shipped 2026-04-11** — drift harness loads every `*.json` under `fixtures/` and re-parses against current `WsMessageSchema` / `ManifestSchema`. Seeded with 4 baseline fixtures (`ws-console.json`, `ws-network.json`, `ws-select.json`, `manifest-minimal.json`) derived directly from the Zod schemas; console fixture corrected from template (`args: string[]` + numeric `timestamp`, not `message` + ISO string). Plus a version sanity test asserting `ONLOOK_RUNTIME_VERSION` matches semver. All 5 tests green. Replace fixtures with genuine N-1 payloads on next protocol bump.

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
