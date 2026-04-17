# Onlook Mobile Client vs. Expo Go — VP Overview

**Prepared:** 2026-04-17
**Audience:** VP Engineering
**Upstream reference:** `github.com/epinnock/expo` (fork of `expo/expo`, SDK 55)
**Subject:** `apps/mobile-client` (Onlook) vs. `apps/expo-go` (Expo)

---

## 1. TL;DR

Expo Go is a **universal developer sandbox** that ships the full Expo SDK in a single
App Store binary so any JavaScript Expo project can be executed against it during
development. Onlook Mobile Client is a **purpose-built runtime host** that mounts
remotely-authored bundles produced by our editor, through our relay, against a
pinned React/reconciler/scheduler triple and a three-module native surface.

The two apps share a family resemblance — both are Expo + React Native + Hermes
applications — but they solve opposite problems:

| | Expo Go | Onlook Mobile Client |
|---|---|---|
| Primary user | Third-party Expo devs | Onlook end-users & editor previewers |
| What it runs | Any Expo JS project | Bundles from `cf-expo-relay` only |
| Native surface | ~70 Expo modules, multi-SDK versioning | 3 modules, single SDK pin |
| Distribution | App Store / Play Store (Expo-owned) | TestFlight → App Store / Play internal → Play Store (Onlook-owned) |
| Update path | EAS Update + Metro dev server | Relay manifest + JSI `OnlookRuntime.runApplication` |
| Strategic role | Generic dev harness | Product surface for Onlook preview |

**Recommendation:** Keep investing in the bespoke client. The properties that make
Expo Go powerful (permissive module surface, SDK fan-in, Expo-controlled signing)
are exactly the properties that make it wrong for our pipeline. See §7.

---

## 2. What Expo Go actually is

Expo Go is packaged in the monorepo as `apps/expo-go` (package name `@expo/home`).
Key shape, from the tree we sparse-checked out:

```
apps/expo-go/
├── android/
│   ├── app/                           # Host Android app
│   ├── expoview/                      # Kernel view wrapping JS apps
│   └── versioned-react-native/        # Multiple RN versions coexisting in-process
├── ios/
│   ├── Exponent.xcworkspace
│   └── Exponent/
│       ├── Kernel/                    # AppLoader, ReactAppManager, DevSupport…
│       ├── Versioned/                 # Per-SDK-version native code
│       ├── ExpoKit/                   # Bridging layer
│       └── DevMenu/
├── modules/                           # In-app dev tools & store listing UI
├── package.json                       # 70+ `expo-*` workspace deps
└── sdkVersions.json                   # { "sdkVersion": "55.0.0" }
```

### Architectural properties

- **Multi-SDK host.** The `Versioned/` and `versioned-react-native/` directories
  mean a single Expo Go binary can execute projects that target older SDKs, with
  native symbols disambiguated per SDK version. That machinery is the reason one
  App Store download can run any Expo project on your laptop.
- **Full SDK fan-in.** `apps/expo-go/package.json` links 70+ `expo-*` workspace
  modules — camera, audio, maps, Stripe, skia, notifications, background fetch,
  SQLite, updates, router, etc. — plus a complete RN peer-dep stack
  (`react@19.2.3`, `react-native@0.85.0`). Everything the SDK advertises is
  linked into the binary so any sandbox JS can import it.
- **Kernel / AppLoader separation.** `ios/Exponent/Kernel/` owns a lobby/home UI,
  pairing flow (QR → Metro dev server), and a `ReactAppManager` that hosts the
  guest React Native instance. The guest's JS bundle is served live from a
  developer's Metro server or from EAS Update manifests.
- **Dev-tools heavy.** `DevMenu/`, `DevSupport/`, and the separate `expo-dev-menu`
  package ship an in-app dev menu, perf monitors, error redbox, element inspector,
  etc. — all oriented toward a developer with a laptop, not an end user.
- **Expo-owned signing and distribution.** Shipped to App Store / Play Store by
  Expo under their provisioning. Contributors can build it from source but the
  README is explicit: "If you just want to install Expo Go… you do not need to
  build it from source… go to expo.dev/go."

### The mental model

Expo Go is a **sandbox interpreter** for the Expo platform. The binary is a
super-set of everything the platform offers so no JS bundle can ever hit a
missing native symbol at runtime.

---

## 3. What Onlook Mobile Client is

Packaged at `apps/mobile-client` (package `@onlook/mobile-client`). From
`package.json`, `app.config.ts`, and `src/`:

```
apps/mobile-client/
├── app.config.ts                      # Single-SDK pin, 3-module allowlist
├── package.json                       # expo@~54.0.33, RN@0.81.6, react@19.1.0
├── src/
│   ├── App.tsx                        # Boots tap bridge + AppRouter
│   ├── navigation/                    # Launcher / Scan / Mounted / Error / Mismatch
│   ├── relay/                         # bundleFetcher, manifestFetcher, liveReload,
│   │                                    wsClient, versionCheck
│   ├── inspector/                     # Element inspector JS glue
│   ├── nativeEvents/                  # JS ↔ native tap bridge
│   ├── deepLink/                      # onlook://launch?session=… handler
│   ├── storage/                       # Recent-sessions (expo-secure-store)
│   └── supported-modules.ts
├── cpp/                               # Pure-JSI C++ (platform-neutral)
│   ├── OnlookRuntime*.cpp             # runApplication / reloadBundle /
│   │                                    dispatchEvent / version / errorSurface
│   ├── OnlookInspector*.cpp           # captureTap / walkTree / screenshot
│   └── *Installer.mm / *_highlight.mm # iOS-only Obj-C++ glue
└── SUPPORTED_MODULES.md               # ADR codifying the allowlist
```

### Architectural properties

- **Single-SDK host.** Exactly one React + reconciler + scheduler triple is
  pinned into the binary (`react@19.1.0`, `react-native@0.81.6` / Expo SDK 54,
  `react-reconciler@0.32.0`, `scheduler@0.26.0`). The binary's job is to stay in
  lockstep with `packages/mobile-preview/runtime/bundle.js`, which is what
  `cf-expo-relay` ships to it.
- **Three-module allowlist.** `expo-camera` (QR scan), `expo-secure-store`
  (session tokens + recent-sessions), `expo-haptics` (dev-tool gesture feedback).
  Everything else is explicitly out, enforced at two layers
  (`app.config.ts` plugins + a forthcoming `react-native.config.js` autolinking
  blocklist, MC1.8).
- **Custom JSI runtime surface.** `globalThis.OnlookRuntime` (HostObject installed
  by a TurboModule) exposes `runApplication(bundleSource, props)`,
  `reloadBundle()`, `dispatchEvent(name, payload)`, and `version`. Bundles never
  touch the filesystem — they travel as `NSData`/`ByteBuffer` straight into
  Hermes. The cpp/ TUs are platform-neutral so Android pickup (MC4.5-android,
  MCF8c) is purely a CMake change.
- **Custom inspector.** `globalThis.OnlookInspector` — `captureTap`, `walkTree`,
  `captureScreenshot`, `highlightNode` — drives the editor's reverse-inspector
  experience. There is no Expo dev menu, no Metro redbox; error surface goes
  through our own path.
- **Relay-native update delivery.** `src/relay/` implements manifest fetching,
  bundle fetching, version check, and a websocket live-reload channel against our
  Cloudflare-hosted relay. No `expo-updates`, no EAS Update, no Metro dev server.
- **Onlook-owned signing and distribution.** Ships as `com.onlook.mobile` to
  TestFlight (iOS preview) and Play Internal (Android preview) under Onlook's
  App Store Connect / Play Console accounts. Version is routed through a single
  `ONLOOK_RUNTIME_VERSION` constant so the store label, the wire protocol, and
  the C++ runtime header cannot drift.

### The mental model

Onlook Mobile Client is a **purpose-built embedded runtime**. The binary is the
smallest possible host that can reliably re-hydrate Onlook-authored bundles at a
stable contract. It is a product component, not a dev harness.

---

## 4. Side-by-side: architecture & engineering trade-offs

| Dimension | Expo Go | Onlook Mobile Client | Implication |
|---|---|---|---|
| **SDK versioning** | Runs multiple SDK versions from one binary (`Versioned/`, `versioned-react-native/`) | Pinned to SDK 54, single React triple | Expo Go trades binary size & build complexity for generality. We trade generality for a stable relay contract. |
| **Native module surface** | ~70 modules linked in | 3 modules (`camera`, `secure-store`, `haptics`) | Our attack surface, binary size, and App Store review surface are a fraction of Expo Go's. |
| **Bundle delivery** | Metro dev server URL or EAS Update channel | Relay manifest → JSI `runApplication(bytes, props)` | We own the full delivery path end-to-end. Observability, auth, rollout gates, A/B are all our decisions. |
| **Update model** | EAS Update (JS-only) or full App Store rebuild for native | Relay manifest for JS; binary rebuild only when the React/RN pin moves | Any SDK-54-compatible bundle published through the relay lights up on every shipped client instantly. |
| **Dev tools** | Dev menu, Metro redbox, perf monitor, element inspector, remote debugger | Custom `OnlookInspector` TurboModule; errors flow through our own `errorSurface` | We control what the end user sees. No Metro redbox leaking to customers. |
| **Entry point / pairing** | Home lobby UI + QR scan of Metro URL + recent-projects list | Launcher → QR scan of `onlook://launch?session=…` → manifest mount | Similar UX, but the target is our relay, not an arbitrary dev server. |
| **JS engine** | Hermes (default) | Hermes (required; the runtime asset is Hermes-compiled) | Same engine, but we depend on Hermes' exact eval semantics for `OnlookRuntime.runApplication`. |
| **Architecture** | New RN architecture supported per-SDK | Bridgeless + Fabric (`newArchEnabled: true`) by default | We are not carrying the old-architecture compat load. |
| **Platforms** | iOS + Android, released in sync | iOS fully landed (Wave 2 complete, 2026-04-16). Android pickup staged (MCF8c, MC4.5-android) | Android is a known gap we've scoped explicitly, not a surprise. |
| **Build host requirements** | macOS only; multi-module gradle build, pod install across dozens of subspecs | iOS build macOS only (Xcode). Android buildable on Linux/Windows with Android SDK. | Our CI footprint is significantly simpler. |
| **Distribution** | App Store / Play Store, controlled by Expo | App Store / Play Store, controlled by Onlook (`com.onlook.mobile`) | We own review cycles, crash reports, entitlements, and the customer-facing app record. |
| **License** | MIT (Expo) | Apache-2.0 (Onlook) | Compatible. Fork gives us audit + patch rights on upstream. |
| **Codebase size** | Multi-SDK native trees, kernel, versioning infra, 70+ modules | ~9 platform-neutral `.cpp` TUs + 3 iOS `.mm` files + a small TS app | One person can hold the whole mobile-client in their head. |

---

## 5. Why we did not just ship Expo Go

This is the question a VP will ask. Four answers, in decreasing order of importance:

1. **Bundle contract stability.** Our relay caches bundles compiled against a
   fixed React + reconciler + scheduler triple. A shipped Expo Go upgrades its
   React peer on Expo's cadence, not ours. The first Expo Go release that moves
   React's reconciler breaks every previously-cached relay bundle on every
   customer's phone. We cannot build a durable preview product on someone
   else's version train.
2. **Binary surface = review surface = compliance surface.** Expo Go ships
   camera, audio, contacts, location, background-fetch, notifications,
   health/tracking, Stripe, etc. Every one of those is a permission string we'd
   have to justify in App Review and a capability we'd have to audit before
   letting an arbitrary bundle use it. Three modules is auditable; seventy is
   not.
3. **We are not in Expo Go's distribution.** Expo Go is in the App Store under
   Expo's record. We cannot brand it, crash-monitor it, ship hotfixes without
   Expo, or gate it to paying Onlook customers. A customer-facing surface must
   live under Onlook's store record.
4. **Sandbox ergonomics are the wrong ergonomics.** Expo Go's redbox, dev menu,
   and Metro toolbar are features for a developer with a laptop. Our end user
   is an Onlook editor user who wants to preview their app on a real device;
   surfacing Metro's dev UI to them is a product regression.

Expo Go is the right answer for "I am an Expo developer prototyping my own
app." It is not the right answer for "I am a vendor shipping a branded mobile
preview surface backed by my own bundle infrastructure."

---

## 6. What we inherit from Expo (and what we don't)

Keeping the Expo SDK as a dependency — even with the allowlist — is deliberate.
We still benefit from:

- Autolinking and prebuild (`expo prebuild` generates the native project trees
  from `app.config.ts`; we don't maintain Xcode and Gradle by hand).
- Hermes integration (`jsEngine: hermes` via config).
- The three modules we do ship, which are battle-tested and maintained upstream.
- `expo-camera` config-plugin handling of Info.plist / AndroidManifest entries.

We deliberately do **not** inherit:

- `expo-updates` — the relay owns JS updates.
- `expo-router` — we have three screens and a state machine.
- `expo-dev-client` / `expo-dev-menu` — the end user is not a developer.
- `expo-file-system` — bundles are in-memory, JSI-delivered.
- EAS Update — the relay is our update system.
- Expo Go the binary — we are the binary.

The fork we just created (`github.com/epinnock/expo`) is a hedge: it gives us
audit rights on upstream changes, a home for patches if we ever need them
pinned to SDK 54, and — should the relationship ever require it — a private
mirror of the SDK packages we consume. Day-to-day we still pull Expo from
public registries; the fork is insurance, not a consumption path.

---

## 7. Recommendation

Continue with the bespoke client. Concretely:

- **Keep the three-module allowlist rigid.** Treat any proposal to expand it as
  an ADR per `SUPPORTED_MODULES.md`, not as a PR.
- **Land Android to parity.** `cpp/README.md` shows the C++ TUs are already
  platform-neutral; Wave 2 has closed iOS. Prioritize MCF8c (Android prebuild +
  Gradle + CMake) and MC4.5-android (inspector highlight) so "ship" means both
  platforms.
- **Treat the fork as an audit mirror, not a divergence.** Merge upstream
  monthly; do not carry Onlook-specific patches against Expo SDK unless there
  is a filed upstream issue we are upstreaming back.
- **Close the versioning story before scaling bundle authoring.** The relay's
  `onlookRuntimeVersion` check on the manifest is the single gate preventing
  stale bundles on upgraded clients; every Wave 3+ feature should assume it
  and fail closed when it trips.

The cost we've paid for building our own client is already spent (Waves 1–2).
The recurring cost is small — an allowlist to defend, a React pin to hold, and
a single pair of native trees to regenerate via `expo prebuild`. The upside is
that the mobile preview surface is now a product we control, not a sandbox we
borrow.

---

## Appendix A — File pointers

Onlook Mobile Client:

- `apps/mobile-client/package.json` — pinned deps
- `apps/mobile-client/app.config.ts` — SDK config, allowlist
- `apps/mobile-client/SUPPORTED_MODULES.md` — full allowlist ADR
- `apps/mobile-client/cpp/` — platform-neutral JSI runtime + inspector
- `apps/mobile-client/src/relay/` — manifest / bundle / version / WS client
- `plans/onlook-mobile-client-plan.md` — source plan
- `plans/wave-progress.md` — live implementation status

Expo Go (fork: `github.com/epinnock/expo`):

- `apps/expo-go/package.json` — full SDK fan-in
- `apps/expo-go/sdkVersions.json` — `{"sdkVersion":"55.0.0"}`
- `apps/expo-go/ios/Exponent/Kernel/` — AppLoader, ReactAppManager, DevSupport
- `apps/expo-go/ios/Exponent/Versioned/` — per-SDK native code
- `apps/expo-go/android/versioned-react-native/` — multi-RN runtime
- `apps/expo-go/README.md` — build instructions (macOS only)
