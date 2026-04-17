# Supported Expo Modules

## What this file is

`@onlook/mobile-client` ships with a hand-picked, restricted Expo module
allowlist. Three modules are in; every other Expo module — including ones you
might reasonably assume the client uses, like `expo-router`, `expo-file-system`,
or `expo-updates` — is explicitly out. This document names the three, explains
why each is carried, and records the rule that keeps the list short.

The allowlist is not a stylistic preference. It exists because the Onlook mobile
client is a **runtime host**, not a regular Expo app: it mounts a JavaScript
bundle that was built elsewhere (by `packages/browser-metro` → `cf-expo-relay`)
against a React + reconciler + scheduler triple that is pinned into the binary
at exact versions. Adding an Expo module that pulls its own React peer
dependency — even a patch-version mismatch — risks breaking the contract that
makes remotely-authored bundles mountable at all. See the "Reconciler version
mismatch" risk row in `plans/onlook-mobile-client-plan.md` for the long form.

The pinned triple, visible in `apps/mobile-client/package.json`, is:

- `react@19.1.0`
- `react-native@0.81.6` (Expo SDK 54)
- `react-reconciler@0.32.0`
- `scheduler@0.26.0`

These four versions must stay in lockstep with
`packages/mobile-preview/runtime/bundle.js`, which is the source of truth the
runtime asset script (`apps/mobile-client/scripts/bundle-runtime.ts`) copies
into the native bundle at build time. A module upgrade that forces any of these
four to move is a binary-contract change, not a dependency bump.

---

## The three allowed modules

### `expo-camera`

`expo-camera` provides the native camera surface and a barcode-scanning
callback. Onlook uses it for exactly one thing: the QR-scanner screen
(`src/screens/ScanScreen.tsx`, landing in Wave 3 task MC3.6) that reads
`onlook://launch?session=<sessionId>&relay=<relayHostOptional>` deep-link URLs
off QR codes emitted by the editor's pairing modal. When the user points the
camera at an Onlook workspace QR, the barcode handler resolves the URL and
hands it to the deep-link launcher that pulls the manifest from the relay and
mounts the bundle.

This module appears twice in the workspace:

1. As a runtime dependency in `apps/mobile-client/package.json`
   (`expo-camera: ~17.0.10`).
2. As a config plugin in `apps/mobile-client/app.config.ts`, inside the
   `plugins: [...]` array, with the `cameraPermission` copy used by the iOS
   permission dialog on first scan. That plugin entry is what lets
   `expo prebuild` wire `NSCameraUsageDescription` into `Info.plist` and the
   `android.permission.CAMERA` entry into `AndroidManifest.xml`.

Both entries are required: the dependency makes `import { CameraView } from
'expo-camera'` work at runtime, and the plugin is what makes the native build
include the camera module and its permission strings.

### `expo-secure-store`

`expo-secure-store` is a thin wrapper over iOS Keychain and Android Keystore,
giving the app a key/value store backed by the OS credential store. Onlook uses
it for two things:

1. Persisting the session tokens the mobile client receives when it pairs with
   an editor. These tokens authorize the client to pull bundles from the relay
   on behalf of the paired Onlook workspace and must not live in plain
   `AsyncStorage`.
2. Backing the "Recent sessions" list on the launcher screen — tuples of
   `(sessionId, projectName, lastSeen)` that let the user reconnect to a
   workspace they've already paired with, without re-scanning a QR. The
   recent-sessions store (`src/storage/recentSessions.ts`, Wave 3 task MC3.8)
   round-trips these tuples through `expo-secure-store`.

Like `expo-camera`, `expo-secure-store` appears in both `package.json` (as a
dependency) and in `app.config.ts`'s `plugins: [...]` array. The config plugin
is needed here because on iOS `expo-secure-store` touches entitlements and on
Android it links a native module; the plugin handles both during
`expo prebuild`.

### `expo-haptics`

`expo-haptics` maps JavaScript haptic-feedback calls to `UIImpactFeedback` on
iOS and `Vibrator` on Android. Onlook uses it to drive tap feedback on the
dev-tools gesture surface — the three-finger tap that opens the in-app debug
menu, plus the pull-to-refresh gesture that remounts the current bundle. It is
not part of the user-visible UI; it's a developer-ergonomics detail on screens
and gestures that are only reachable in dev builds.

The important structural point about `expo-haptics` is that it lives in
`package.json` **but not in the plugins array of `app.config.ts`**. That
asymmetry is deliberate, and the inline comment in `app.config.ts` (around
lines 59–62) spells out why: `expo-haptics` is a runtime-only module. It ships
no `app.plugin.js`, has no config-plugin surface, and does not need to hook
into `expo prebuild` to inject Info.plist keys or gradle changes. It is linked
by autolinking at build time and imported at runtime; that is the full
integration story. Putting it in the `plugins: [...]` array would make
`expo prebuild` error out because there is no plugin module to resolve.

So when you scan this file or `app.config.ts` and notice `expo-camera` and
`expo-secure-store` in the plugins array but not `expo-haptics`, that is not
an oversight — it is the difference between config-plugin modules (the first
two) and runtime-only modules (the third).

---

## Explicitly unsupported

Everything else is out. No wiggle room, no "we'll add one more for this one
feature." The reason the bar is this high is that the runtime bundle shipped in
`packages/mobile-preview/runtime/bundle.js` is built against a specific React
reconciler + scheduler pair (`react-reconciler@0.32.0`, `scheduler@0.26.0`),
and the native binary must ship those exact versions in its Hermes bundle.
Expo modules that bring in a conflicting React peer, or that transitively pull
newer reconciler/scheduler releases, break the contract between the binary and
every previously-built Onlook bundle in the relay's cache.

A few illustrative rejections, not an exhaustive list:

- **`expo-router`** — brings its own React peer-dep assumptions and a full
  file-system-based router layer. The mobile client has exactly three screens
  (Launcher, Scan, Mounted-bundle) and routes between them with a one-off
  state machine. We don't need a router, and a router that pins a different
  React minor would be a showstopper.
- **`expo-file-system`** — tempting for "download the bundle to disk and read
  it back" flows, but unnecessary. In Wave 2 the bundle travels through a
  native JSI path (`OnlookRuntime.eval(script)`) that never materializes on
  the filesystem; it lives in a `NSData`/`ByteBuffer` handed straight to
  Hermes. Adding `expo-file-system` would double the I/O surface and add a
  Swift module we'd then have to audit for security.
- **`expo-updates`** — the whole point of this binary is that it is the host,
  not the thing being updated. The JavaScript payload updates through the
  relay's manifest flow, not through EAS Update. `expo-updates` would
  introduce a parallel bundle-management system that fights the relay.
- **`expo-notifications`**, **`expo-dev-client`**, **`expo-task-manager`**,
  **`expo-av`**, **`expo-image-picker`** — none are load-bearing for the
  "mount a remotely-authored bundle and display it" use case. If a shipped
  Onlook bundle wants audio or notifications, that capability has to come
  from the runtime bundle itself, not from a native module we linked into the
  host.

The rule: **if it is not in the three-module allowlist above, it is not in the
build.** Not in `package.json`, not in `app.config.ts`, not linked by
autolinking, not smuggled in as a transitive dep. Binary size matters (the
plan's risk register calls out 100–500KB per Expo module), but the bigger
reason is the React-version-pin contract.

---

## How enforcement works

The allowlist is enforced in two places:

1. **`apps/mobile-client/app.config.ts`**, specifically the `plugins: [...]`
   array. Expo config plugins run at `expo prebuild` time and are how a module
   injects its Info.plist keys, gradle entries, entitlements, and permission
   strings. If a module is not in this array, it does not get native wiring
   at prebuild — which means QR scanning, secure storage, and haptics can be
   in the build only because they are in this array (or, in the case of
   haptics, because they don't need a plugin at all; see above).

   This is the first line of defense, but it is soft: a rogue `bun add
   expo-something` would still land in `node_modules` and be autolinked by
   React Native's default autolinking machinery even without an `app.config.ts`
   plugin entry. We need a second line.

2. **`apps/mobile-client/react-native.config.js`**, the autolinking blocklist,
   which explicitly disables every Expo module that is not in the allowlist.
   This is a forward reference: at the time this document landed, task **MC1.8**
   (Wave 1) had not yet run. MC1.8's job is to add `react-native.config.js`
   with a `dependencies` block that sets `platforms: { ios: null, android:
   null }` for each disallowed module, which is the React Native CLI's
   documented mechanism for opting out of autolinking on a per-module basis.
   Its validate step proves the blocklist is load-bearing by greping
   `ios/Pods/Pods.xcodeproj/project.pbxproj` for a representative disallowed
   module name and asserting it is not present.

   Until MC1.8 lands, enforcement relies entirely on discipline plus the
   `app.config.ts` plugins array. That is why the dependency list in
   `package.json` is also short: if it is not in `dependencies`, it cannot be
   autolinked, full stop. Keeping `package.json` lean is therefore the
   third, implicit, enforcement layer.

The two-layer design (config plugins + autolinking blocklist) is a defense in
depth: the plugin array handles the "needs native wiring" case, and the
autolinking blocklist catches anything that slips through as a transitive dep
or an accidental `bun add`.

---

## Adding a new module

This is not a ticket. It is an ADR.

If you believe the Onlook mobile client needs a new Expo module, the process
is:

1. Open a discussion (issue, design doc, Linear ticket — whichever channel the
   team is using for architectural decisions at the time) that names the
   module, the use case, and — critically — **the module's React,
   react-reconciler, and scheduler peer-dep ranges at the version you want to
   pin**. If those ranges don't include the values listed at the top of this
   file, the proposal is dead on arrival and the discussion is about whether
   to move the pins, not whether to add the module.
2. If the peer ranges are compatible, audit the module's native surface
   (`ios/`, `android/`) for any capability the App Store review process would
   flag — remote-code execution, background execution, private API usage —
   because the mobile client already walks a fine line on RCE and every
   additional native module is another thing the reviewer can ask about.
3. Measure the binary-size impact against the plan's 100–500KB per-module
   budget and record it in the ADR.
4. Only then open a PR that touches `package.json`,
   `app.config.ts`, `react-native.config.js` (to remove the module from the
   autolinking blocklist), **and this file** in the same commit. All four
   changes travel together or none of them do.

A PR that adds an Expo module without a corresponding ADR and without
updating this file will be rejected at review. The restriction is not
bureaucracy; it is how the relay's cached bundles continue to mount on
shipped clients six months from now.
