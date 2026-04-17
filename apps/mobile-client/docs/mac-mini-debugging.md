# Mac mini + iPhone Debugging Playbook

Field notes for debugging the Onlook Mobile Client on the shared
`spectra-macmini` + reference iPhone, collected during the `feat/mobile-client`
build-out. Focus: what to do **after** you already have a signed `.app` and
need to diagnose something. For first-time install / signing see
[`install-on-device.md`](./install-on-device.md).

## 1. SSH into the Mac mini

```bash
ssh -i ~/.ssh/spectra-macmini scry-farmer@192.168.0.17
```

- **Host:** `192.168.0.17` (hostname `DeviceFarmers-Mac-mini.local`)
- **User:** `scry-farmer` (admin group, passwordless sudo)
- **Key:** `~/.ssh/spectra-macmini` on the Linux dev box
- **macOS password:** see `~/ui-automator/docs/mac-mini-device-farm.md` — do
  NOT persist it anywhere in this repo or agent memory.

**zsh login-shell caveat:** non-interactive SSH does **not** source
`.zprofile`, so Homebrew is missing from PATH. Wrap anything that needs
`/opt/homebrew/bin` in a login shell:

```bash
ssh -i ~/.ssh/spectra-macmini scry-farmer@192.168.0.17 \
  "zsh -l -c 'which ios-deploy && ios-deploy --version'"
```

Or pipe a heredoc: `ssh ... "zsh -l" << 'EOF' ... EOF`.

## 2. Keychain unlock for codesign

Symptom: `xcodebuild` fails with `errSecInternalComponent` /
`Command CodeSign failed with a nonzero exit code`. Cause: the login keychain
is locked (Mac mini runs headless). Fix before `xcodebuild`:

```bash
# Unlock for this session.
security unlock-keychain -p "<mac-password>" ~/Library/Keychains/login.keychain-db

# Extend auto-lock so it doesn't relock mid-build (7200 s = 2 h).
security set-keychain-settings -lut 7200 ~/Library/Keychains/login.keychain-db
```

## 3. `ios-deploy` flag matrix

| Flag          | Behavior                                                     | Use for                     |
|---------------|--------------------------------------------------------------|-----------------------------|
| `--justlaunch`| Install + launch + detach. **SIGKILLs the app on detach when `get-task-allow=true`** — looks like a crash. | Reinstall only, **NOT** validation |
| `--debug`     | Install + launch + stay attached. stdout/stderr stream until Ctrl-C. | Capturing boot output       |
| `--noinstall` | Skip install; just launch the already-installed bundle.      | Relaunching                 |
| `--bundle`    | Path to the `.app` directory.                                | Always                      |
| `--id`        | Target UDID (omit for "first connected device").             | Multi-device hosts          |

**Don't use `--justlaunch` to check whether the app launched cleanly** — the
SIGKILL-on-detach is indistinguishable from a real crash. Use `--debug` with a
timed kill:

```bash
ssh -i ~/.ssh/spectra-macmini scry-farmer@192.168.0.17 "zsh -l" << 'EOF'
  cd ~/onlook/apps/mobile-client
  timeout 20 ios-deploy \
    --debug \
    --bundle build/Build/Products/Debug-iphoneos/OnlookMobileClient.app \
    --id 00008030-XXXXXXXXXXXXXXXX \
    2>&1 | tee /tmp/onlook-boot.log
EOF
```

Pure reinstall: `ios-deploy --noinstall --debug --bundle <.app> --id <UDID>`.

## 4. `idevicedebug run` — matches home-screen tap

`ios-deploy --debug` attaches a debugserver, which subtly changes runtime
behavior. When you need the app to behave exactly as it does when a human taps
the icon (reproduces "works via Xcode, fails from home screen" issues):

```bash
idevicedebug -u <UDID> run com.onlook.mobile
```

stdout/stderr stream until Ctrl-C.

## 5. `idevicesyslog` — streaming device log

```bash
# Just our app. -p matches executable name, not bundle ID.
idevicesyslog -u <UDID> -p OnlookMobileClient 2>&1 | tee /tmp/onlook.syslog

# Combine with a grep filter for boot markers + errors.
idevicesyslog -u <UDID> -p OnlookMobileClient | grep -E '\[onlook-runtime\]|FATAL|Exception'
```

## 6. `idevicescreenshot` — single PNG

```bash
idevicescreenshot -u <UDID> /tmp/onlook-$(date +%s).png
scp -i ~/.ssh/spectra-macmini scry-farmer@192.168.0.17:/tmp/onlook-*.png ./
```

Useful when a test says "the app is running" but you want visual confirmation
the splash cleared and the RN view mounted.

## 7. `idevicecrashreport` — pull crash logs

When the app died but syslog doesn't show why (common with bridgeless new-arch
crashes that happen before RN's logger attaches):

```bash
mkdir -p /tmp/onlook-crashes
idevicecrashreport -u <UDID> /tmp/onlook-crashes
ls /tmp/onlook-crashes | grep -i onlook
```

Relevant files are `*.ips` (iOS 15+); backtrace includes the pre-RN-init
thread that faulted.

## 8. Device discovery

```bash
# Works for iOS 15 through current — preferred for our 15.1 reference device.
xcrun xctrace list devices

# iOS 17+ only; silently omits older devices.
xcrun devicectl list devices
```

On Xcode 16.x against an iOS 15.1 device, `devicectl` returns nothing and
`xctrace list devices` is the only path. `ios-deploy` and `idevice*` tools
enumerate via usbmuxd and work regardless.

## 9. Full build + install chain

Run from `apps/mobile-client/` on the Mac mini (after `bun install` at root):

```bash
bun run bundle-runtime                                # JS bundle into .app
bun x expo prebuild --platform ios                    # regen ios/ from app.config.ts
(cd ios && pod install)                               # CocoaPods
security unlock-keychain -p "<pw>" ~/Library/Keychains/login.keychain-db  # §2

xcodebuild \
  -workspace ios/OnlookMobileClient.xcworkspace \
  -scheme OnlookMobileClient \
  -configuration Debug \
  -destination 'platform=iOS,id=<UDID>' \
  -derivedDataPath build \
  -allowProvisioningUpdates

ios-deploy \
  --bundle build/Build/Products/Debug-iphoneos/OnlookMobileClient.app \
  --id <UDID> --debug
```

`-derivedDataPath build` keeps output under `apps/mobile-client/build/` so
Xcode's global DerivedData doesn't shadow your artifacts. The
`mobile:install:device` script (see `install-on-device.md` §4a) automates
the last two steps after the first successful signing.

## 10. Boot marker grep

The native host emits structured markers during launch. Grep for them to
verify the expected sequence:

```bash
idevicesyslog -u <UDID> -p OnlookMobileClient | grep '\[onlook-runtime\]'
```

Expected sequence on a healthy boot:

```
[onlook-runtime] host-init: starting
[onlook-runtime] host-init: bundle loaded (<N> bytes)
[onlook-runtime] bridge: fabric-mount ok
[onlook-runtime] rn-root: mounted
[onlook-runtime] preview: listening on <port>
```

Missing `fabric-mount ok` after `bundle loaded` is the classic bridgeless
fail — see section 11.

## 11. Known issues

- **iOS 15.1 reference device + bridgeless new-arch.** The RN runtime
  documents bridgeless + Fabric as iOS 16+ in practice. The mobile client
  Podfile declares 15.1 for historical reasons, but boot on 15.x fails silently
  between `bundle loaded` and `fabric-mount`. Validate on iOS 17+ and treat
  15.x as a best-effort target.
- **iPhone 15 simulator missing under Xcode 16.x.** The "iPhone 15" runtime
  was renamed; you'll see `iPhone 15 Pro` / `iPhone 16`. Adjust simulator
  `-destination` strings accordingly or use `xcrun simctl list devicetypes`
  to discover what's installed.
- **`xcodebuild` hanging on "Preparing device for development".** First run
  after an iOS update reindexes device symbols (10–30 min). Don't kill it;
  `idevicesyslog` shows `dtdevicemanager` progress.
- **`ios-deploy --justlaunch` false-positive SIGKILL.** Documented in
  section 3. Use `--debug` + `timeout` for any launch you intend to assert
  against.
- **Mac mini clock drift** occasionally invalidates provisioning profiles
  ("profile not valid yet"). `sudo sntp -sS time.apple.com` resyncs.
