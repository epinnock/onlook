# Onlook Mobile Client — Handoff / Pickup Document

**Date:** 2026-04-11
**Branch:** `feat/mobile-client`
**Target reader:** whoever picks this up on a new Mac (specifically an Apple Silicon machine on macOS 14.5+ with Xcode 16.1+)
**Source plan:** `plans/onlook-mobile-client-plan.md`
**Task queue:** `plans/onlook-mobile-client-task-queue.md`

---

## TL;DR

Phase F of the task queue is **13.5 / 14 tasks complete**. The only blocker is **`pod install`** inside the `expo prebuild` output, which requires **Xcode ≥ 16.1** per RN 0.81.6's Podfile check (`node_modules/react-native/scripts/cocoapods/helpers.rb:87`). The machine the work started on is an Intel Mac with Xcode 15.4 on macOS 14.3.1 — below the `macos 14.5` minimum needed to install Xcode 16.1. A new Mac with the right tooling finishes MCF8b in under 30 minutes and then dispatches Waves 1–6 via worktree-isolated subagents.

**Nothing is lost. All work to date is committed on `feat/mobile-client` and pushed via this PR.**

---

## Branch state

```
e5c9f227 feat(mobile-client): Expo entry + app config + root component (MCF8 prep)
dee6ce1a docs: ExpoBrowser merge end-to-end validation report          ← parallel user commit
fa78cd94 feat(mobile-client): CI workflow + Maestro harness + runtime asset wiring (MCF9 + MCF10 + MCF11)
60b9a3be docs(mobile-client): adopt xcode-scribe pattern for pbxproj hotspot (decision 2026-04-11)
acd3c8e0 feat(mobile-client): scope guard template + validate-task harness (MCF12 + MCF13)
75a89fc1 feat(mobile-client-protocol): populate types MCF3-MCF7
5e2b3797 feat(mobile-client): scaffold workspace + protocol package (MCF1 + MCF2)
78f33d40 docs(mobile-client): add source plan and parallel task queue
702e265e Merge remote-tracking branch 'origin/main'                    ← main HEAD when branch was cut
```

## Phase F task status

| Task | What | State | Where |
|---|---|---|---|
| MCF0 | Cut `feat/mobile-client` | ✅ | `78f33d40` |
| MCF1 | `apps/mobile-client/package.json` workspace | ✅ | `5e2b3797` |
| MCF2 | `packages/mobile-client-protocol/` scaffold | ✅ | `5e2b3797` |
| MCF3 | Bundle envelope Zod types + 6 tests | ✅ | `75a89fc1` |
| MCF4 | Relay manifest Zod schema + 5 tests | ✅ | `75a89fc1` |
| MCF5 | WebSocket message union + 8 tests | ✅ | `75a89fc1` |
| MCF6 | Inspector descriptors + 7 tests | ✅ | `75a89fc1` |
| MCF7 | `ONLOOK_RUNTIME_VERSION` + `isCompatible()` + 13 tests | ✅ | `75a89fc1` |
| **MCF8a** | `app.config.ts` + `index.js` + `src/App.tsx` | ✅ | `e5c9f227` |
| **MCF8b** | `expo prebuild --platform ios` + `pod install` + `xcodebuild` smoke | ⛔ blocked | — |
| **MCF8c** | Android prebuild + Gradle build | ⏸ deferred | — |
| MCF9 | Maestro harness scaffold + `00-smoke.yaml` | ✅ | `fa78cd94` |
| MCF10 | `.github/workflows/mobile-client.yml` | ✅ | `fa78cd94` |
| MCF11 | `bundle-runtime.ts` + 13 tests | ✅ | `fa78cd94` |
| MCF12 | Scope guard `.claude/rules.template.md` | ✅ | `acd3c8e0` |
| MCF13 | `validate-task.ts` harness + 4 tests | ✅ | `acd3c8e0` |

Also landed:
- **Queue update** adopting the "xcode-scribe" pattern (`60b9a3be`) — each Wave gets one serialized sub-task that batches `project.pbxproj` additions via the `xcodeproj` Ruby gem. The original "MCF8 pre-registers every anticipated stub file" approach was dropped as too fragile to do by hand across ~40 wave tasks.

---

## Validation status (on the Intel Mac as of 2026-04-11 02:30 CT)

- **56 unit tests passing across 7 test files:**
  - `packages/mobile-client-protocol` — 39 tests (bundle-envelope, manifest, ws-messages, inspector, runtime-version)
  - `apps/mobile-client/scripts` — 4 tests (validate-task) + 13 tests (bundle-runtime)
- **Both new workspaces typecheck clean:**
  - `bun --filter @onlook/mobile-client-protocol typecheck` → exit 0
  - `bun --filter @onlook/mobile-client typecheck` → exit 0
- **Maestro CLI installed and parses flow files** — only fails at runtime with "0 devices connected," which is the expected state without MCF8b.
- **`expo prebuild --platform ios --no-install --clean` succeeds locally** on Xcode 15.4. The generated `ios/` tree is deterministic given `app.config.ts`; it was NOT committed to this branch because the new machine can regenerate it identically in 30 seconds and then run the `pod install` step that 15.4 blocks.

---

## The blocker (in detail, so you don't retrace my steps)

### What failed

Running `pod install` inside the locally-generated `apps/mobile-client/ios/` directory errored out at:

```
React Native requires XCode >= 16.1. Found 15.4.
[!] Invalid `Podfile` file: Please upgrade XCode.
```

### Where the check lives

`node_modules/react-native/scripts/cocoapods/helpers.rb:87–89`:

```ruby
def self.min_xcode_version_supported
    return '16.1'
end
```

Called from `utils.rb:428` (`check_minimum_required_xcode`) as part of `use_react_native!` in the Podfile. It's a hard raise — no CLI flag bypasses it.

### Why the Intel Mac can't satisfy it

- **Local Xcode:** 15.4 (the last Xcode to support macOS 14.3.x)
- **Local macOS:** 14.3.1 (Sonoma)
- **Xcode 16.1 requires macOS 14.5+** — so just "download a newer Xcode" isn't enough; the base OS has to advance too
- **The Mac is Intel** — Xcode 16.x still supports Intel in principle (verify with Apple's "System requirements" page before committing to a 15GB download), but build times will be 2–4× slower than Apple Silicon for a typical RN project

### Why we're not working around it

Three workarounds were considered and rejected:

1. **Downgrade to Expo SDK 53 / RN 0.79** (Xcode 15.4 compatible) — would break the React 19.1.0 ↔ reconciler 0.32.0 ↔ scheduler 0.26.0 exact-match pin that MCF1 set against `packages/mobile-preview/runtime/bundle.js`. The source plan's "Reconciler version mismatch" risk row is the reason for that pin; giving it up unilaterally would set up a silent failure mode for Wave 2's JSI binding work.
2. **Patch the RN `utils.rb` check** via `bun patch react-native` — bypasses the check but moves the failure mode to "cryptic linker errors from C++20 features during build" with no bisect path.
3. **Android-first** — violates the source plan's "iOS first because Phase B's verification rig is iPhone-only" cut line.

The correct answer is a machine that actually satisfies the tooling requirement. Hence this handoff.

---

## Pickup instructions for the new Mac

### Prerequisites

| Tool | Minimum | How to install |
|---|---|---|
| macOS | 14.5 (Sonoma) | System Preferences → Software Update |
| Xcode | **16.1** | App Store latest, OR `developer.apple.com/download/more` for a pinned 16.1 `.xip` if you need to avoid a newer version |
| Command Line Tools | matching Xcode | `sudo xcode-select --switch /Applications/Xcode.app/Contents/Developer && sudo xcodebuild -license accept` |
| CocoaPods | 1.16+ | `brew install cocoapods` |
| Homebrew | latest | `/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"` |
| openjdk | 17 | `brew install openjdk@17` (needed by Maestro — its CLI needs a JRE) |
| Maestro | 0.15+ | `brew tap mobile-dev-inc/tap && brew install mobile-dev-inc/tap/maestro` (NOT `brew install maestro` — that's a different product) |
| Bun | 1.3.6 | Already pinned in `packageManager` — `curl -fsSL https://bun.sh/install \| bash` |
| Node | 20+ | Any recent Node works; Bun covers most of the need |

**Android tooling is optional for the iOS-first path.** If you want Android eventually: `brew install --cask zulu@17` (or any JDK 17), Android Studio for the SDK, then export `ANDROID_HOME`. MCF8c handles that later.

### Verify before you start

```bash
xcodebuild -version                 # Xcode 16.1+
pod --version                       # 1.16+
PATH="/usr/local/opt/openjdk@17/bin:$PATH" maestro --version   # 0.15+
bun --version                       # 1.3.6+
```

### Bring the branch up

```bash
cd <your-clone-of-onlook>
git fetch origin
git checkout feat/mobile-client
bun install                         # 205 new packages, ~30s warm, ~60s cold
```

### Finish MCF8b

```bash
cd apps/mobile-client
bun x expo prebuild --platform ios --no-install --clean
cd ios
pod install                         # first run ~3-5 min (downloads spec-repo), warm is ~45s
xcodebuild \
    -workspace OnlookMobileClient.xcworkspace \
    -scheme OnlookMobileClient \
    -configuration Debug \
    -sdk iphonesimulator \
    -destination 'platform=iOS Simulator,name=iPhone 15' \
    build | tail -30
```

Expected result: `** BUILD SUCCEEDED **` at the bottom. If you get a code-signing warning, that's expected for simulator builds — no signing is required.

### Commit MCF8b

```bash
cd ../../..                        # back to onlook/
git add apps/mobile-client/ios
git commit -m "feat(mobile-client): expo prebuild iOS tree + pod install (MCF8b)"
```

The commit will be large (~5000 lines of generated code). That's expected — the source plan explicitly wants this committed as first-class native code so no future `expo prebuild` run mutates it silently. From this point on, `ios/` is edited by Wave tasks through the xcode-scribe pattern, not regenerated.

### Smoke-check with Maestro

```bash
export PATH="/usr/local/opt/openjdk@17/bin:$PATH"   # or add to ~/.zshrc
open -a Simulator                   # boots a simulator so Maestro has a device
cd apps/mobile-client
maestro test e2e/flows/00-smoke.yaml
```

Expected result: the smoke flow runs, `apps/mobile-client/verification/results.json` gets a `flows["00-smoke"]` entry with `state: "passed"`.

If this is green, **Phase F is 14/14 complete**. Proceed to Wave 1 dispatch.

---

## Wave 1 dispatch (the next step after MCF8b lands)

Wave 1 is the first real use of the parallel-agent orchestration. 12 tasks (`MC1.1` through `MC1.12` from the task queue), with dependency gates. The orchestration model that the queue was designed around:

1. **Worktree per task.** For each task, `git worktree add -b ai/<task-id>-<slug> .trees/<task-id>-<slug> feat/mobile-client`.
2. **Scope guard per worktree.** Copy `apps/mobile-client/.claude/rules.template.md` into `.trees/<task-id>-<slug>/.claude/rules.md`, fill in the `<TASK_ID>` and `<FILES>` placeholders.
3. **Spawn one subagent per worktree** via the `Agent` tool with `isolation: "worktree"`. Up to 8 concurrent agents.
4. **Validate on exit.** The subagent runs its task's `Validate:` command. Pass/fail bubbles up via the validate-task harness writing to `verification/results.json`.
5. **Merge in dependency order** into `feat/mobile-client`. Never out of order. Pre-warm the xcode-scribe sub-task (`MC1.X`) between Wave 1's content tasks and `MC1.11`/`MC1.12` so all new Swift/Kotlin files get added to `project.pbxproj`/`build.gradle` in one batch.
6. **Dead-letter on retry exhaustion** (3 attempts with test output fed as context). Appended to `apps/mobile-client/verification/dead-letter.json`.

The orchestration logic itself isn't scripted yet — the task queue's `## Orchestrator invocation` section sketches `claude --task-queue plans/... --phase 1 --concurrency 8` as the intended command, but that was aspirational. In practice on a new machine, a human (or a meta-agent) will walk the queue task-by-task and spawn `Agent` calls with `isolation: "worktree"` manually. This is fine for v1.

---

## Decisions already baked in (don't re-litigate without an ADR)

1. **E2E framework: Maestro.** YAML flows, runs headless on iOS Simulator and Android Emulator, cross-platform. Picked over Detox for author simplicity. Fallback marker `device-only` for anything the simulator can't express (`MCI.5` is the only such task).
2. **React version pin: exactly 19.1.0** to match `packages/mobile-preview/runtime/bundle.js`. `react-reconciler` pinned to `0.32.0`, `scheduler` pinned to `0.26.0`. These are the versions inside the 241KB Onlook runtime. Any deviation triggers the reconciler-mismatch risk from the source plan.
3. **Expo SDK 54 / RN 0.81.6.** Not 53, not 55. This combination is the one that both (a) ships with React 19.1.0 as a peer, and (b) works with Xcode 16.1. Do NOT bump to SDK 55 / RN 0.85 — RN 0.85 requires React 19.2.3 which breaks the reconciler pin.
4. **iOS first, Android deferred.** Source plan cut line. Android `MCF8c` and Android-side Wave 4 tasks wait for Wave 1 iOS green.
5. **xcode-scribe pattern over stub pre-registration.** Each wave's new Swift/ObjC/C++ files land in one serialized sub-task that batches pbxproj additions via the `xcodeproj` Ruby gem. See `plans/onlook-mobile-client-task-queue.md` "Hotspot file registry" row for `project.pbxproj`.
6. **Module allowlist: `expo-camera`, `expo-secure-store`, `expo-haptics` only.** Everything else stays out. Enforced in `app.config.ts` plugins + Wave 1 task `MC1.8` (`react-native.config.js`).
7. **Runtime asset wiring:** `packages/mobile-preview/runtime/bundle.js` is treated as the source of truth. `apps/mobile-client/scripts/bundle-runtime.ts` copies it into `ios/.../Resources/onlook-runtime.js` + `android/.../assets/onlook-runtime.js` at build time, with a sibling `.meta.json` for drift detection. The runtime file itself is NOT duplicated into `apps/mobile-client` — the build step reads from the source.

---

## Open questions still worth an ADR (from the task queue's "Open questions" section)

1. **Maestro vs Detox fallback.** If Maestro can't drive the three-finger long-press for the Wave 5 dev menu (`MC5.10`), framework swap is required. Low probability, high blast radius.
2. **Runtime asset pinning across long-running branch.** `packages/mobile-preview/runtime/bundle.js` is under active development elsewhere. MCF11's bundle-runtime script writes a sha256 to `onlook-runtime.meta.json` so drift is detectable. Consider pinning a specific commit hash in `bundle-runtime.ts` if drift becomes a problem.
3. **Editor-side touchpoints are under-scoped.** MC3.19, MC4.15–17, MC5.16–17 all land in `apps/web/client` but their file paths are best-effort — the tasks should grep for real paths and adjust as they go.
4. **Sucrase `jsx-source` fidelity (MC4.12).** If Sucrase doesn't have a hook point to emit `__source`, fall back to a Babel plugin (adds a bundler dep + parse pass). Dead-letter on first failure and decide then.

---

## Known git history quirk: `dee6ce1a` ↔ `b0c1714d`

While the Intel Mac was waiting for the tooling checkpoint on 2026-04-11, the developer committed `dee6ce1a` ("docs: ExpoBrowser merge end-to-end validation report") directly on top of `feat/mobile-client`, then checked out `main` and cherry-picked it as `b0c1714d`. This means:

- **Local `main`** has `b0c1714d` — the cherry-picked copy
- **`feat/mobile-client`** has `dee6ce1a` — the original
- **Same file content, different commit hashes** (different parents)

When this PR is merged, `dee6ce1a` and `b0c1714d` will both be in the history. That's harmless but ugly. Two cleanup options:

**Option 1 (safest): leave it.** The tree state is correct; the duplicate is purely a commit-log artifact. `git log` just shows two commits with the same message.

**Option 2 (cleaner): rebase `feat/mobile-client` to drop `dee6ce1a` before merging.**

```bash
git checkout feat/mobile-client
git rebase --onto fa78cd94 dee6ce1a feat/mobile-client
# This puts e5c9f227 directly on top of fa78cd94, skipping dee6ce1a
git push --force-with-lease origin feat/mobile-client
```

Only do Option 2 if you're comfortable force-pushing a feature branch and no one else has pulled it.

---

## File inventory

### New files on `feat/mobile-client`

```
apps/mobile-client/
├── .claude/
│   └── rules.template.md                          MCF12 — scope guard template
├── app.config.ts                                  MCF8a — Expo config
├── e2e/
│   ├── flows/
│   │   └── 00-smoke.yaml                          MCF9 — harness smoke flow
│   └── maestro.config.yaml                        MCF9 — Maestro config
├── index.js                                       MCF8a — Expo entry
├── package.json                                   MCF1 — workspace (hotspot)
├── scripts/
│   ├── __tests__/
│   │   ├── bundle-runtime.test.ts                 MCF11 — 13 tests
│   │   └── validate-task.test.ts                  MCF13 — 4 tests
│   ├── bundle-runtime.ts                          MCF11 — runtime asset wiring
│   └── validate-task.ts                           MCF13 — per-task validate harness
├── src/
│   ├── App.tsx                                    MCF8a — boot-to-black root
│   └── index.ts                                   MCF1 — trivial placeholder
├── tsconfig.json                                  MCF1 — extends @onlook/typescript/base
└── verification/
    ├── .gitkeep                                   MCF9
    └── results.json                               MCF9 — orchestrator state

packages/mobile-client-protocol/
├── package.json                                   MCF2 — workspace
├── src/
│   ├── bundle-envelope.ts                         MCF3
│   ├── bundle-envelope.test.ts                    MCF3 — 6 tests
│   ├── index.ts                                   MCF2 — hotspot re-export index
│   ├── inspector.ts                               MCF6
│   ├── inspector.test.ts                          MCF6 — 7 tests
│   ├── manifest.ts                                MCF4
│   ├── manifest.test.ts                           MCF4 — 5 tests
│   ├── runtime-version.ts                         MCF7
│   ├── runtime-version.test.ts                    MCF7 — 13 tests
│   ├── ws-messages.ts                             MCF5
│   └── ws-messages.test.ts                        MCF5 — 8 tests
└── tsconfig.json                                  MCF2

.github/workflows/
└── mobile-client.yml                              MCF10 — CI with pre-declared wave job slots

plans/
├── onlook-mobile-client-plan.md                   source plan (architectural rationale)
├── onlook-mobile-client-task-queue.md             ~115-task queue (Phase F + Waves 1-6 + I)
└── onlook-mobile-client-handoff.md                THIS FILE
```

### Pre-existing files that are NOT touched by this branch (for reference)

- `apps/cf-expo-relay/src/manifest-builder.ts` — will be touched by Wave 6 `MC6.2` to add `extra.expoClient.onlookRuntimeVersion`
- `packages/browser-metro/src/host/index.ts` — will be touched by Wave 4 `MC4.12` for the `target: 'onlook-client' | 'expo-go'` flag + Sucrase `jsx-source` hook
- `packages/mobile-preview/runtime/bundle.js` — READ ONLY from this branch's point of view. The build step in `bundle-runtime.ts` copies it but never modifies it.
- `apps/web/client/src/components/.../qr-modal/` — will be touched by Wave 3 `MC3.19` to add `onlook://` to the QR payload alongside `exp://`

---

## Quick reference: commands the new machine will run

```bash
# 1. bring up
git fetch origin && git checkout feat/mobile-client && bun install

# 2. finish MCF8b
cd apps/mobile-client
bun x expo prebuild --platform ios --no-install --clean
cd ios && pod install
xcodebuild -workspace OnlookMobileClient.xcworkspace \
  -scheme OnlookMobileClient -configuration Debug \
  -sdk iphonesimulator -destination 'platform=iOS Simulator,name=iPhone 15' build

# 3. commit MCF8b
cd ../../..
git add apps/mobile-client/ios
git commit -m "feat(mobile-client): expo prebuild iOS tree + pod install (MCF8b)"

# 4. smoke-test Maestro harness
export PATH="/usr/local/opt/openjdk@17/bin:$PATH"   # or install JDK with java on PATH
open -a Simulator
cd apps/mobile-client && maestro test e2e/flows/00-smoke.yaml

# 5. sanity-check everything still green
cd ../..
bun --filter @onlook/mobile-client-protocol typecheck
bun --filter @onlook/mobile-client typecheck
bun test packages/mobile-client-protocol/src
bun test apps/mobile-client/scripts/__tests__

# 6. start Wave 1 dispatch (manual, until the orchestrator is scripted)
#    Read plans/onlook-mobile-client-task-queue.md Wave 1 section.
#    For each MC1.x, create a worktree, copy the scope guard template,
#    spawn an agent, validate, merge.
```

---

## Contact / context

This branch was built by Claude Opus 4.6 in a Claude Code session on 2026-04-11. The session's commit authorship is tagged via `Co-Authored-By: Claude Opus 4.6 (1M context) <noreply@anthropic.com>`. Full session decisions (why this approach, why SDK 54 specifically, why xcode-scribe) are captured in the task queue and the commit messages — read both before making non-trivial changes.

**The task queue is the source of truth.** If you find that the decomposition is wrong or the hotspot registry has a gap, STOP, update the queue, and commit that as a docs change before proceeding. Do not silently diverge from it — other people picking this up will assume the queue still matches reality.

---

## Supplementary docs (2026-04-16 session)

This handoff predates the 2026-04-16 session in which the first on-device iPhone deploy landed. The following artifacts capture what happened after this doc was frozen — read these before picking up work, as several assumptions here (Android parity, bundle shape, C++ graph) have since been refined.

- [plans/post-mortems/2026-04-16-runtime-d-r-clobber.md](post-mortems/2026-04-16-runtime-d-r-clobber.md) — post-mortem on the runtime D/R clobber incident and the fix that unblocked iOS bring-up.
- [plans/release-notes/2026-04-16-first-iphone-deploy.md](release-notes/2026-04-16-first-iphone-deploy.md) — release notes for the first successful on-device iPhone deploy, including what shipped and what is deferred.
- [plans/android-blocked-inventory.md](android-blocked-inventory.md) — inventory of Android-side blockers discovered during this session; consult before attempting Android parity work.
- [plans/cpp-dependency-graph.md](cpp-dependency-graph.md) — current C++ dependency graph for the native runtime; authoritative reference for Fabric/TurboModule surface changes.
- [plans/followups.md](followups.md) — rolling list of follow-ups (non-blocking cleanups, deferred polish) queued out of this session.
- [plans/handoff-2026-04-17.md](handoff-2026-04-17.md) — next-day handoff supplementing this document with the current state and immediate next steps.
- [apps/mobile-client/docs/install-on-device.md](../apps/mobile-client/docs/install-on-device.md) — step-by-step guide for installing the mobile client onto a physical iPhone.
- [apps/mobile-client/docs/mac-mini-debugging.md](../apps/mobile-client/docs/mac-mini-debugging.md) — debugging playbook for the shared Mac mini (spectra-macmini) used for iOS builds.
- [apps/mobile-client/docs/combined-bundle-format.md](../apps/mobile-client/docs/combined-bundle-format.md) — spec for the combined runtime + app bundle format shipped to devices.
- [apps/mobile-client/docs/onboarding.md](../apps/mobile-client/docs/onboarding.md) — onboarding guide for new contributors joining the mobile-client effort.
