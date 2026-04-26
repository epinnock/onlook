# Install Onlook Mobile Client on a Physical iPhone

Human-driven runbook for getting the Onlook Mobile Client onto a physical
iPhone for the first time. Use this for the MCI.5 "physical-device DoD walk"
and for anyone who needs a dev build on hardware.

This path is **not** covered by CI — see section 6.

---

## 1. Prerequisites

### Host

- macOS (Apple Silicon or Intel). The build must happen on a Mac; Linux/Windows
  cannot codesign for iOS.
- **Xcode 16.1+** installed from the Mac App Store, launched at least once so
  its command-line tools are provisioned (`xcode-select -p` should resolve).
- Bun 1.3.6+ (repo baseline). Do not substitute npm/yarn/pnpm.
- CocoaPods available on PATH (`pod --version` should succeed).

### Apple account

- Apple Developer Program team **enrolled** (paid). A free Apple ID can sign a
  personal 7-day build but cannot own the `com.onlook.mobile` bundle identifier
  alongside other developers — for shared work you want a real team.
- The team must own or be able to register the bundle identifier
  `com.onlook.mobile` (set in `apps/mobile-client/app.config.ts`).

### Device

- iPhone running **iOS 15.1 or newer**. 15.1 is the deployment-target floor
  declared in `apps/mobile-client/ios/Podfile`, but the Mobile Client uses
  React Native's bridgeless runtime + New Architecture, which is not
  well-validated on iOS 15. **Recommendation: use iOS 17+** for reliable
  behavior; lower versions may build and install but have not been verified on
  hardware.
- **Developer Mode enabled** (iOS 16+): Settings → Privacy & Security →
  Developer Mode → On, then restart the device when prompted.
- USB-to-Lightning / USB-C cable capable of data (not charge-only).
- Device **trusted** for the Mac: on first connect the iPhone prompts "Trust
  this computer?" — tap Trust and enter the passcode.

---

## 2. From a cold clone

Run from the repo root unless noted:

```bash
# 1. Install workspace deps.
bun install

# 2. Build the mobile runtime bundle (consumed by the native host).
bun run build:mobile-runtime

# 3. Move into the mobile-client package for the iOS-specific steps.
cd apps/mobile-client

# 4. Emit the JS bundle that ships inside the .app.
bun run bundle-runtime

# 5. Generate (or refresh) the native iOS project from app.config.ts.
bun x expo prebuild --platform ios

# 6. Install CocoaPods into the generated workspace.
cd ios && pod install && cd ..

# 7. Build + install to a connected device.
bun x expo run:ios --device <UDID>
```

**First build must go through Xcode** to accept a team and generate a
provisioning profile — see section 4. After that, the CLI `expo run:ios
--device <UDID>` path works headlessly for subsequent builds.

---

## 3. Finding the iPhone UDID

### iOS 17 and newer

```bash
xcrun devicectl list devices
```

Sample output:

```
Devices:
Name                    Identifier                            State      Model
ejiro-iphone-15         00008120-001A2B3C4D5E6F7G             connected  iPhone15,3
```

The `Identifier` column is the UDID to pass to `--device`.

### iOS 16 and older (and as a fallback)

```bash
xcrun xctrace list devices
```

Sample output:

```
== Devices ==
ejiro-iphone-15 (17.4.1) (00008120-001A2B3C4D5E6F7G)
ejiro-macbook-pro (14.4) (XXXXXXXX-XXXXXXXXXXXXXXXX)

== Simulators ==
iPhone 15 Pro (18.0) (ABCDEF01-...)
```

The UDID is the value in the trailing parentheses on the device line.

---

## 4. First-time signing (Xcode GUI)

The first build on a new machine or new team needs Xcode's UI to provision
signing:

1. Open `apps/mobile-client/ios/OnlookMobileClient.xcworkspace` in Xcode
   (the `.xcworkspace`, **not** the `.xcodeproj` — CocoaPods requires the
   workspace).
2. In the Project Navigator, select the `OnlookMobileClient` project, then
   the `OnlookMobileClient` target.
3. Go to **Signing & Capabilities**.
4. Tick **Automatically manage signing**.
5. Choose your **Team** from the dropdown. Xcode will provision a profile for
   `com.onlook.mobile` against that team.
6. If the team does not yet own `com.onlook.mobile`, Xcode offers to register
   it — accept, provided this account has permission to reserve identifiers
   for the team.
7. Select the connected iPhone as the run destination (top bar) and press
   **Run** (Cmd-R). This both builds and installs.

Subsequent builds can skip Xcode and use `bun x expo run:ios --device <UDID>`
from `apps/mobile-client/`.

---

## 4a. Shortcut via npm script

Once Xcode has produced a signed `Debug-iphoneos` `.app` (section 4, or any
subsequent `xcodebuild`/`expo run:ios --device` run), reinstalling onto the
same phone no longer needs Xcode — the `mobile:install:device` script wraps
the `ios-deploy` invocation we validated during MCI.5:

```bash
# From repo root or apps/mobile-client/:
bun run --filter @onlook/mobile-client mobile:install:device -- --device=<UDID>

# Or, with the UDID pinned in your shell environment:
export ONLOOK_DEVICE_UDID=<UDID>
bun run --filter @onlook/mobile-client mobile:install:device
```

The script:

- Requires `ios-deploy` on PATH (`brew install ios-deploy` on macOS). It fails
  fast with that suggestion when missing.
- Picks the newest `OnlookMobileClient.app` from either
  `apps/mobile-client/build/Build/Products/Debug-iphoneos/` (local
  `-derivedDataPath` builds) or
  `~/Library/Developer/Xcode/DerivedData/OnlookMobileClient-*/Build/Products/Debug-iphoneos/`
  (Xcode's default). If neither has a bundle, it tells you to run
  `bun run mobile:build:ios` first.
- Launches with `--justlaunch` so the process detaches after install —
  matching the MCI.5 walkthrough behaviour on the iOS 15.1 reference device.

This is a reinstall convenience only. The very first build on a new machine
or after bundle-ID churn still needs the Xcode GUI signing step in section 4.

---

## 4b. Headless rebuilds via `mobile:build:ios -- --device`

Once Xcode signing is set up (section 4), you can skip both `expo run:ios`
and Xcode GUI for subsequent builds. `apps/mobile-client/scripts/run-build.ts`
takes a `--device` flag that switches the wrapper from a simulator build to
a real-iPhone `Debug-iphoneos` build:

```bash
# From repo root:
DEVELOPMENT_TEAM=<your-team-id> bun run mobile:build:ios -- --device

# Or pass the team via flag:
bun run mobile:build:ios -- --device --team=<your-team-id>
```

The flag toggles:

- `-sdk iphonesimulator` → `-sdk iphoneos`
- `'generic/platform=iOS Simulator'` → `'generic/platform=iOS'`
- drops `CODE_SIGNING_ALLOWED=NO`
- adds `-allowProvisioningUpdates` + `CODE_SIGN_STYLE=Automatic`
- threads `DEVELOPMENT_TEAM=<id>` to xcodebuild for automatic signing

`--device` and `--sim=<name>` are mutually exclusive (the script exits 2
if both are passed).

Once the device build lands in DerivedData, chain into the install:

```bash
DEVELOPMENT_TEAM=<your-team-id> bun run mobile:build:ios -- --device && \
  ONLOOK_DEVICE_UDID=<UDID> bun run --filter @onlook/mobile-client mobile:install:device
```

Like section 4a, this is a reinstall convenience — the first signing setup
still happens through Xcode GUI in section 4, because `xcodebuild
-allowProvisioningUpdates` only refreshes existing provisioning, it does
not bootstrap a new Apple Developer account into Xcode → Settings →
Accounts (that step is interactive-only).

---

## 5. Troubleshooting

- **Device shows as "unavailable"** in Xcode / `devicectl`: the phone is
  locked, untrusted for this Mac, or Developer Mode is off. Unlock, re-accept
  the Trust prompt, and confirm Developer Mode is on.
- **Pairing / "could not pair with device" errors**: disconnect, re-connect,
  and watch for a fresh "Trust this computer?" prompt on the phone. If none
  appears, try a different cable/port — charge-only cables silently fail.
- **Build artifacts look stale** (phantom missing symbols, old JS bundle):
  force a clean rebuild with `bun x expo run:ios --no-build-cache --device
  <UDID>`. If that is not enough, remove Xcode's derived data:
  `rm -rf ~/Library/Developer/Xcode/DerivedData/OnlookMobileClient-*`.
- **Provisioning profile mismatch on install**: bundle ID drift between
  `app.config.ts` and the Xcode target. Re-run `bun x expo prebuild --platform
  ios --clean` to regenerate the project, then redo the signing step.
- **`pod install` failures** after a prebuild: delete `ios/Pods` and
  `ios/Podfile.lock` inside `apps/mobile-client/ios/`, then rerun `pod
  install`.
- **`errSecInternalComponent` from codesign on a headless / SSH session**:
  the build host's login keychain locks per session and codesign can't
  reach the signing identity's private key. Each `ssh user@host …` opens a
  fresh session that inherits a locked keychain even if the GUI session is
  unlocked. Fix: prepend an unlock to every remote build invocation, e.g.

  ```bash
  ssh scry-farmer@192.168.0.17 \
    "security unlock-keychain -p '<macOS-password>' ~/Library/Keychains/login.keychain-db && \
     export PATH=/opt/homebrew/bin:\$PATH && \
     cd ~/onlook/apps/mobile-client/ios && \
     xcodebuild -workspace OnlookMobileClient.xcworkspace -scheme OnlookMobileClient \
       -configuration Debug -sdk iphoneos -destination 'generic/platform=iOS' \
       -allowProvisioningUpdates DEVELOPMENT_TEAM=<TEAM_ID> CODE_SIGN_STYLE=Automatic build"
  ```

  As a one-time setup that lets codesign reach the key without prompting,
  also run (replace `<password>`):

  ```bash
  security set-key-partition-list -S apple-tool:,apple: \
    -k '<password>' ~/Library/Keychains/login.keychain-db
  ```

  Without that the unlock-per-session pattern still works but each fresh
  `xcodebuild` will hit `errSecInternalComponent` until unlocked. Manual
  test: `codesign --force --sign <identity-hash> <some-framework>` should
  return 0 in the same SSH session before xcodebuild will.

  ⚠️ **Don't bypass `bun run mobile:build:ios -- --device` with a bare
  `xcodebuild` invocation.** The wrapper runs three steps: (1)
  `generate-version-header.ts`, (2) `bundle-runtime.ts` (refreshes
  `OnlookMobileClient/Resources/onlook-runtime.js`), and (3) `bun x expo
  export:embed` (re-bakes `main.jsbundle` from the current source).
  Skipping the wrapper leaves a stale `main.jsbundle` in the .app — the
  device installs but runs YOUR LAST BUILD'S JS code, not the source you
  just edited. Symptom: a code change ships, the .app reinstalls, the
  behavior doesn't change. Use the wrapper:

  ```bash
  ssh scry-farmer@192.168.0.17 \
    "security unlock-keychain -p '<macOS-password>' ~/Library/Keychains/login.keychain-db && \
     export PATH=/opt/homebrew/bin:\$PATH && \
     cd ~/onlook && \
     DEVELOPMENT_TEAM=<TEAM_ID> bun run mobile:build:ios -- --device"
  ```

  …then `bun run mobile:install:device` (no flags — the auto-detect
  picks up the only attached iPhone). This was caught during the
  spectra Mac mini iPhone 8 e2e session: a preflight code change
  appeared not to take effect because the bare-xcodebuild rebuild hadn't
  re-baked the JS bundle.

---

## 6. CI considerations

This runbook is **human-driven**. CI (`.github/workflows/mobile-client.yml`,
`wave1-ios` job) only produces **simulator** builds — it has no signing
identities and no attached hardware. The physical-device Definition of Done
walk is task **MCI.5** in `plans/onlook-mobile-client-task-queue.md` and
requires a human with a Mac, a signing team, and a phone.

For TestFlight distribution (non-dev, shareable) see
[`MC6.5-testflight.md`](./MC6.5-testflight.md). For the Play Store equivalent
see [`MC6.6-play-store.md`](./MC6.6-play-store.md).
