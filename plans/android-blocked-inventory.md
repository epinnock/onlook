# Android-blocked task inventory

Last updated: 2026-04-16.

Scope: Android-side work in `feat/mobile-client` that is parked behind
`MCF8c` (Android prebuild + Gradle). iOS-side equivalents have shipped; the
C++ translation units (TUs) under `apps/mobile-client/cpp/` that are
platform-neutral already exist and just need CMake to pick them up.

## Blocker: MCF8c — Android prebuild + Gradle assembleDebug

Source: `plans/onlook-mobile-client-task-queue.md:211`.

### What it produces
- `expo prebuild --platform android` output: the entire
  `apps/mobile-client/android/**` tree (Gradle wrapper, `settings.gradle`,
  `app/build.gradle`, `MainActivity.kt`, `MainApplication.kt`,
  `AndroidManifest.xml`, baseline `cpp/CMakeLists.txt`).
- Green `./gradlew assembleDebug` on an emulator-targetable APK.

### What it needs (not Xcode)
- JDK 17 on `PATH` (handoff recommends `zulu@17` or any JDK 17).
- Android SDK with `platform-tools` + `platforms;android-34`.
- Android Studio (for SDK manager / emulator; CLI-only works if
  `cmdline-tools;latest` + `emulator` packages are installed).
- `ANDROID_HOME` exported; Android NDK (pulled in transitively by RN 0.81's
  Gradle plugin — no manual version pin required).
- CocoaPods / Xcode are **not** required for MCF8c. The iOS-side blocker
  (`MCF8b`, Xcode ≥ 16.1) is orthogonal.

### Why it has not landed
The `feat/mobile-client` cut line is explicit: "iOS first because Phase B's
verification rig is iPhone-only" (source plan, handoff line 213). MCF8c
waits for Wave 1 iOS to be green — that gate has now cleared (every
iOS-path Wave 1/2/3/4/5 task shipped per queue line 977), so MCF8c is no
longer cross-blocked by iOS work. The only thing standing between today and
an Android build is a machine with JDK 17 + Android SDK. The Mac mini
already has Xcode 16.1 for iOS; adding the Android toolchain is the
single remaining environmental step.

### Dependency chain
`MCF8c` depends on `MCF8a` (Expo config + `app.config.ts` — shipped as
`e5c9f227`). No other gating work. It is **not** blocked on `MCF8b`
(iOS prebuild) — Android prebuild is independently runnable.

## Blocked tasks

Wave 1:

| Task | Purpose | Android surface | LOC estimate |
|------|---------|-----------------|--------------|
| MC1.5 | Activity lifecycle + Hermes bootstrap | Kotlin `MainActivity.kt` (RN host + Hermes JS engine selection) | 50-200 |
| MC1.6 | Application bootstrap (package registration) | Kotlin `MainApplication.kt` (ReactApplication + Expo package list) | 50-200 |
| MC1.7 | Hermes init / JSI `onlook-runtime.js` prepend | C++ `hermes_bootstrap.cpp` + JNI binding + CMake wiring (Android mirror of `HermesBootstrap.swift`) | 50-200 |
| MC1.10a | Logger module for `[onlook-runtime]` log prefix | Kotlin `OnlookLogger.kt` (API-matched mirror of `OnlookLogger.swift`; 47 LOC on iOS) | <50 |
| MC1.12 | CI job: Android emulator build + Wave 1 flows | `.github/workflows/mobile-client.yml` — fill in the `wave1-android` slot MCF10 pre-reserved | <50 |

Wave 2:

| Task | Purpose | Android surface | LOC estimate |
|------|---------|-----------------|--------------|
| MC2.2a | Android compile of the C++ JSI host-object skeleton | CMake wiring only; `apps/mobile-client/cpp/OnlookRuntime.cpp` is platform-neutral and already compiles on iOS. Source TU is unchanged. | <50 (CMake) |
| MC2.4 | Android JNI installer that puts `OnlookRuntime` on `globalThis` | C++/JNI `onlook_runtime_installer.cpp` (JNI wrapper around the shared `OnlookRuntimeInstaller` C++ TU — iOS Obj-C++ wrapper is 54 LOC, C++ body 103 LOC shared) | 50-200 |
| MC2.6 | Fabric `registerEventHandler` pre-JS call | C++/JNI `fabric_event_bootstrap.cpp` — note iOS pivoted to a pragmatic `UITapGestureRecognizer` bridge after the real Fabric hook proved infeasible under bridgeless; Android may need the same pragmatic cut | 50-200 |

Wave 4 — Inspector (Android parity):

| Task | Purpose | Android surface | LOC estimate |
|------|---------|-----------------|--------------|
| MC4.7 | `OnlookInspector` TurboModule registration | Kotlin `OnlookInspector.kt` (TurboModule skeleton; mirrors iOS C++ host object which is 228 LOC, but Kotlin surface is thinner since heavy lifting stays in shared C++) | 50-200 |
| MC4.8 | `captureTap(x, y)` — find node at point | Kotlin `OnlookInspectorCaptureTap.kt` (Fabric `findNodeAtPoint` via JSI; native side calls into shared C++) | 50-200 |
| MC4.9 | `walkTree(reactTag)` — shadow-tree walker | Kotlin `OnlookInspectorWalkTree.kt` (Android Fabric shadow-tree introspection; iOS analogue shipped as `ad45cdf3`) | 50-200 |
| MC4.10 | `captureScreenshot()` → base64 PNG | Kotlin `OnlookInspectorScreenshot.kt` (`View.draw(canvas)` path + base64 encode) | 50-200 |
| MC4.11 | `highlightNode(reactTag, color)` + tap forwarder (merged per queue note) | Kotlin `OnlookInspectorOverlay.kt` — highlight overlay draw + tap event forwarding to JS. iOS highlight TU is 355 LOC (Obj-C++); Android tends to be chattier so expect the upper band of this bracket. | 200-1000 |

CI + misc:

| Task | Purpose | Android surface | LOC estimate |
|------|---------|-----------------|--------------|
| MC1.12 | Wave 1 Android CI job (listed above) | `mobile-client.yml` append | <50 |
| (implicit) wave4-android | Already pre-stubbed in `mobile-client.yml` per MC4.19 status; needs to be filled in to match `wave4-ios` shape | `mobile-client.yml` append | <50 |
| (implicit) wave5-android | Console/network streamer + error-boundary flows on Android emulator. Only `MC5.2` ships a JS-only streamer; Android validation parity means running the existing Wave 5 flows on the emulator runner. | `mobile-client.yml` append | <50 |

Notes on MC5.2-android: the closing task-queue summary (line 977) mentions
"MC5.2-android" as parked. MC5.2's implementation is pure JS
(`consoleStreamer.ts`, shipped as `d40537d5`); what is parked is the
**Android emulator validation run** of it, not a separate native TU. It
rolls up under the wave5-android CI stub and needs no new Kotlin/JNI
surface.

## Total estimate to complete Android surface post-MCF8c

Implementation — 10 blocked tasks with a native-code footprint, plus CI:

- 3 Kotlin/Java files that are direct mirrors of small iOS Swift siblings
  (MC1.5, MC1.6, MC1.10a). Aggregate ballpark: 100-400 LOC.
- 1 C++/JNI Hermes bootstrap (MC1.7) mirroring `HermesBootstrap.swift` +
  `bundleURL` prepend — Android equivalent happens in
  `MainApplication.kt`'s bundle resolution path per ADR
  `plans/adr/MC1.4-MC2.10-runtime-context.md:41`. Ballpark: 100-250 LOC
  (mostly JNI glue + CMake).
- 1 C++/JNI installer (MC2.4) wrapping the already-shared
  `OnlookRuntimeInstaller` C++ TU. Ballpark: 50-150 LOC JNI + a handful of
  CMake lines.
- 1 C++/JNI Fabric event bootstrap (MC2.6) — possibly collapses to a
  pragmatic Android `GestureDetector` analogue if the real Fabric hook is
  infeasible, same as iOS. Ballpark: 50-250 LOC.
- 5 Kotlin inspector surfaces (MC4.7 through MC4.11). MC4.11 is the fat
  one (overlay draw + tap dispatch). Aggregate ballpark: 400-1200 LOC;
  MC4.11 alone may approach the upper half of that.
- CMake wiring for all of the above: the existing 9 platform-neutral C++
  TUs audited in MC2.2.1 just need `add_library` / `target_sources`
  additions. Ballpark: <50 LOC of CMake.

**Aggregate native-code ballpark: ~700-2250 LOC across ~10 tasks**, with
most of the range concentrated in Wave 4 inspector parity (MC4.7–MC4.11).
This is a cautious bracket — actual Kotlin tends to be more compact than
the iOS Swift+C++ split because Kotlin can talk to RN's TurboModule
infrastructure directly without an Obj-C++ wrapper tier.

Testing — rough fixture count:
- Unit/Kotlin tests for each inspector TurboModule: ~5 tasks × a small
  test file each. No JVM test harness currently exists in
  `apps/mobile-client/android/**` so the first Wave 4 task doubles as
  harness setup. Bracket: 5-10 test files.
- Maestro e2e flows: all Android flows (`01-boot`, `02-black-screen`,
  `03-hermes-eval`, `04-global-present`, `05-fabric-event-registered`,
  `06-red-square`, `21`–`27`) already exist as iOS flows. Running them on
  Android emulator requires zero new YAML — the `mobile:e2e:android`
  wrapper already targets the emulator via Maestro's cross-platform
  runner. Bracket: 0 new flows authored; ~12 flows re-validated.

CI — mostly slot-fill:
- `wave1-android`, `wave4-android`, `wave5-android` jobs are already
  pre-stubbed in `.github/workflows/mobile-client.yml` (per MC4.19 status
  line). Filling them in mirrors the existing `wave1-ios` / `wave4-ios` /
  `wave5-ios` job shapes. Ballpark: 3 YAML stanzas, ~30-60 lines each.

## Open questions

- **Real Fabric `registerEventHandler` vs pragmatic tap-gesture bridge on
  Android.** iOS shipped the pragmatic `UITapGestureRecognizer` path
  because bridgeless `[RCTBridge currentBridge]` returns nil and the
  Fabric registration API is not publicly exposed from Obj-C++ (see MC2.5
  rationale in queue). Android's Fabric layer has different private
  surfaces — the pragmatic `GestureDetector` substitute may or may not be
  necessary. Pick mid-task; do not spend a multi-hour research loop like
  iOS did.
- **Android Studio vs CLI-only Android SDK on the Mac mini.** Android
  Studio pulls in ~6GB; `sdkmanager` CLI is ~400MB. CLI-only is enough
  for CI and builds; Android Studio is only needed for interactive
  debugging of `MainActivity.kt` / `MainApplication.kt`. Recommendation:
  CLI-only on CI runners, Android Studio on the dev Mac mini when
  debugging the first Wave 1 task.
- **Emulator choice for CI.** macos-14 GitHub runners can host an
  Android emulator but start times push job wall-clock past 15 minutes.
  Google's `reactivecircus/android-emulator-runner@v2` is the typical
  path; API level should match `platforms;android-34`. Pin ABI to x86_64
  on CI (not arm64) — Apple Silicon macos-14 runners do ship x86_64
  emulation via Rosetta but native-arm64 emulator images are faster when
  available.
- **Does MC4.11's overlay need a platform-specific re-design?** iOS's
  `OnlookInspector_highlight.mm` is 355 LOC (heavy Obj-C++ `UIView`
  manipulation). Android's `WindowManager` overlay story is different
  enough that straight translation will be inefficient — expect some
  design work, not just Kotlin transliteration.
- **Android-side prebuild commit or generated-at-build?** MCF8a note (line
  209) says Info.plist + AndroidManifest.xml are expanded from
  `app.config.ts` at prebuild time, and that pbxproj/build.gradle surgery
  uses an "xcode-scribe" pattern on iOS. Android equivalent (a
  `gradle-scribe` or just direct `build.gradle` edits via the
  `android-project-scripts` mechanism) should be clarified before
  MC1.5/MC1.6 land, so subsequent Kotlin-adding tasks have a consistent
  pattern.
