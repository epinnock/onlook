# C++ surface dependency graph

Snapshot of `apps/mobile-client/cpp/` + iOS Swift/Obj-C bridge as of
commit `54dcd3db` on branch `feat/mobile-client`. Purpose: inform the Android
port plan (MCF8c — Android prebuild + CMake wiring) by classifying which
translation units are platform-neutral and which carry iOS-only dependencies.

MC2.2.1 audit already confirmed the C++ surface was **designed** to be
platform-neutral; this doc tabulates per-file dependencies so the Android
team can see at a glance which files compile as-is and which need a
Kotlin/JNI or plain-C++ equivalent.

## Files

| File | Role | Platform | Deps (includes) |
|------|------|----------|-----------------|
| `OnlookRuntime.h` | Header: `onlook::OnlookRuntime` JSI host object + free-function decls (`getRuntimeVersion`, `runApplicationImpl`, `reloadBundleImpl`, `dispatchEventImpl`, `reportRuntimeError`, `captureAndReport`, `prewarmInspector`) | Neutral | `<jsi/jsi.h>`, `<functional>`, `<memory>`, `<string>` |
| `OnlookRuntime.cpp` | Host-object skeleton: `get`/`set`/`getPropertyNames`, per-method delegators | Neutral | `"OnlookRuntime.h"`, `<jsi/jsi.h>`, `<memory>`, `<stdexcept>`, `<string>`, `<vector>` |
| `OnlookRuntime_runApplication.cpp` | MC2.7 body — delegated from `OnlookRuntime::runApplication` | Neutral | `"OnlookRuntime.h"`, `<jsi/jsi.h>`, `<memory>`, `<string>` |
| `OnlookRuntime_reloadBundle.cpp` | MC2.8 body — delegated | Neutral | `"OnlookRuntime.h"`, `<jsi/jsi.h>` |
| `OnlookRuntime_dispatchEvent.cpp` | MC2.9 body — delegated | Neutral | `"OnlookRuntime.h"`, `<jsi/jsi.h>` |
| `OnlookRuntime_errorSurface.cpp` | MC2.14 `reportRuntimeError` + `captureAndReport` | Neutral | `"OnlookRuntime.h"`, `<jsi/jsi.h>`, `<exception>`, `<functional>` |
| `OnlookRuntime_version.cpp` | Returns build-time-baked version string | Neutral | `"OnlookRuntime.h"`, `"OnlookRuntime_version.generated.h"` |
| `OnlookRuntime_version.generated.h` | Build-generated constant (by `apps/mobile-client/scripts/generate-version-header.ts`) | Neutral | (none beyond generator) |
| `OnlookRuntimeInstaller.h` | Pure-C++ TurboModule decl for `install()` | Neutral | `<ReactCommon/TurboModule.h>`, `<memory>`, `<string>` |
| `OnlookRuntimeInstaller.cpp` | TurboModule `install()` body — wires `globalThis.OnlookRuntime` + calls `prewarmInspector` | Neutral | `"OnlookRuntimeInstaller.h"`, `"OnlookRuntime.h"`, `<jsi/jsi.h>`, `<memory>`, `<string>` |
| `OnlookRuntimeInstaller.mm` | Obj-C++ `RCTTurboModule` wrapper that vends the C++ module | iOS-only | `<Foundation/Foundation.h>`, `<React/RCTBridgeModule.h>`, `<ReactCommon/RCTTurboModule.h>`, `"OnlookRuntimeInstaller.h"` |
| `InspectorPrewarm.cpp` | MC2.15 `prewarmInspector(rt)` — calls `nativeFabricUIManager.findNodeAtPoint(-1,-1)` | Neutral | `"OnlookRuntime.h"`, `<jsi/jsi.h>` |
| `OnlookInspector.h` | Header: `onlook::OnlookInspector` JSI host object + free-function decls (`highlightNodeImpl`, `captureScreenshotImpl`, `walkTreeImpl`) | Neutral | `<jsi/jsi.h>`, `<memory>`, `<string>` |
| `OnlookInspector.cpp` | Host-object skeleton: `get`/`set`/`getPropertyNames`, per-method delegators | Neutral | `"OnlookInspector.h"`, `<jsi/jsi.h>`, `<memory>`, `<stdexcept>`, `<string>`, `<vector>` |
| `OnlookInspector_highlight.mm` | MC4.5 `highlightNodeImpl` — RCTSurfacePresenter + RCTComponentViewRegistry + RCTMountingManager + RCTBridge + RCTUIManager to find the UIView and stamp a 2pt CAShapeLayer border | iOS-only | `<Foundation/Foundation.h>`, `<UIKit/UIKit.h>`, `<React/RCTSurfacePresenter.h>`, `<React/RCTComponentViewRegistry.h>`, `<React/RCTMountingManager.h>`, `<React/RCTBridge.h>`, `<React/RCTUIManager.h>`, `"OnlookInspector.h"`, `<jsi/jsi.h>`, `<string>` |
| `OnlookInspector_screenshot.mm` | MC4.4 `captureScreenshotImpl` — `UIGraphicsImageRenderer` + `UIImagePNGRepresentation` + base64 | iOS-only | `<Foundation/Foundation.h>`, `<UIKit/UIKit.h>`, `"OnlookInspector.h"`, `<jsi/jsi.h>`, `<string>` |
| `OnlookInspector_walkTree.mm` | MC4.3 `walkTreeImpl` — recursive `nativeFabricUIManager` traversal. Body is pure JSI; `.mm` suffix is inherited from the iOS Xcode group | Neutral (body) / iOS-only (build target) | `"OnlookInspector.h"`, `<jsi/jsi.h>`, `<unordered_set>` |
| `OnlookInspectorInstaller.h` | Pure-C++ TurboModule decl for `install()` | Neutral | `<ReactCommon/TurboModule.h>`, `<memory>`, `<string>` |
| `OnlookInspectorInstaller.cpp` | TurboModule `install()` body — wires `globalThis.OnlookInspector` | Neutral | `"OnlookInspectorInstaller.h"`, `"OnlookInspector.h"`, `<jsi/jsi.h>`, `<memory>`, `<string>` |
| `OnlookInspectorInstaller.mm` | Obj-C++ `RCTTurboModule` wrapper | iOS-only | `<Foundation/Foundation.h>`, `<React/RCTBridgeModule.h>`, `<ReactCommon/RCTTurboModule.h>`, `"OnlookInspectorInstaller.h"` |

### `.cpp` → `.h` inclusion edges

- `OnlookRuntime.cpp`, `OnlookRuntime_runApplication.cpp`,
  `OnlookRuntime_reloadBundle.cpp`, `OnlookRuntime_dispatchEvent.cpp`,
  `OnlookRuntime_errorSurface.cpp`, `OnlookRuntime_version.cpp`,
  `InspectorPrewarm.cpp`, `OnlookRuntimeInstaller.cpp` → `OnlookRuntime.h`
- `OnlookRuntime_version.cpp` → `OnlookRuntime_version.generated.h`
- `OnlookRuntimeInstaller.cpp`, `OnlookRuntimeInstaller.mm` →
  `OnlookRuntimeInstaller.h`
- `OnlookInspector.cpp`, `OnlookInspector_highlight.mm`,
  `OnlookInspector_screenshot.mm`, `OnlookInspector_walkTree.mm`,
  `OnlookInspectorInstaller.cpp` → `OnlookInspector.h`
- `OnlookInspectorInstaller.cpp`, `OnlookInspectorInstaller.mm` →
  `OnlookInspectorInstaller.h`

### `.mm` → declarations they implement

- `OnlookInspector_highlight.mm` implements `onlook::highlightNodeImpl`
  (declared in `OnlookInspector.h`).
- `OnlookInspector_screenshot.mm` implements `onlook::captureScreenshotImpl`
  (declared in `OnlookInspector.h`).
- `OnlookInspector_walkTree.mm` implements `onlook::walkTreeImpl`
  (declared in `OnlookInspector.h`). Body uses only JSI — see "Android-portable"
  note below.
- `OnlookRuntimeInstaller.mm` and `OnlookInspectorInstaller.mm` implement the
  `RCTTurboModule` Obj-C side of `OnlookRuntimeInstaller` /
  `OnlookInspectorInstaller` (pure-C++ `install()` bodies live in the matching
  `.cpp` files).

## Android-portable .cpp files (platform-neutral)

- `OnlookRuntime.cpp`
- `OnlookRuntime_runApplication.cpp`
- `OnlookRuntime_reloadBundle.cpp`
- `OnlookRuntime_dispatchEvent.cpp`
- `OnlookRuntime_errorSurface.cpp`
- `OnlookRuntime_version.cpp` (consumes `OnlookRuntime_version.generated.h`,
  which is emitted by the cross-platform
  `apps/mobile-client/scripts/generate-version-header.ts`)
- `OnlookRuntimeInstaller.cpp`
- `OnlookInspectorInstaller.cpp`
- `OnlookInspector.cpp`
- `InspectorPrewarm.cpp`
- `OnlookInspector_walkTree.mm` — despite the `.mm` extension the source
  only depends on `<jsi/jsi.h>` and `<unordered_set>`; it is portable if
  renamed to `.cpp` (or included in Android's CMake with C++ compilation)

## iOS-only .mm files (need Android equivalents)

- `OnlookInspector_highlight.mm` — Obj-C body lives in this file;
  depends on `UIKit` (`UIView`, `CAShapeLayer`) and RN iOS headers
  (`RCTSurfacePresenter`, `RCTComponentViewRegistry`, `RCTMountingManager`,
  `RCTBridge`, `RCTUIManager`). Android mirror: JNI into a Kotlin/Java helper
  that walks the native view tree, likely via `ReactContext` +
  `UIManagerHelper.getUIManager(...).resolveView(reactTag)` + overlay draw on
  the resolved `View`.
- `OnlookInspector_screenshot.mm` — Obj-C body in this file; depends on
  `UIKit` (`UIGraphicsImageRenderer`, `UIImagePNGRepresentation`). Android
  mirror: `PixelCopy.request` against the root `Surface`, then `Bitmap` →
  `ByteArrayOutputStream` → base64 via JNI callback.
- `OnlookRuntimeInstaller.mm` — Obj-C++ `RCTTurboModule` wrapper. Android
  equivalent: `ReactModuleWithSpec` / `TurboModuleManagerDelegate` entry in
  `android/app/src/main/java/...` that calls into the pure-C++ `install()`.
- `OnlookInspectorInstaller.mm` — same structure as above.

## C++ ↔ Swift bridge

### Bridging header

`apps/mobile-client/ios/OnlookMobileClient/OnlookMobileClient-Bridging-Header.h`
exposes only:

- `#import "FabricEventBootstrap.h"`

### `HermesBootstrap.swift`

- Does **not** call any C++ symbol directly. Composes
  `onlook-runtime.js` + `main.jsbundle` at the Swift/`Data` layer and
  returns the combined `Data` to `AppDelegate.bundleURL()`. No JSI call.

### `AppDelegate.swift`

- Calls `FabricEventBootstrap.registerHandler()` (Obj-C class method, not
  C++). That Obj-C class sits at
  `apps/mobile-client/ios/OnlookMobileClient/FabricEventBootstrap.{h,mm}`
  and — per file header — is a logging placeholder today; it uses
  `NSClassFromString(@"OnlookTapForwarder")` to post to the tap-forwarder
  event emitter. No direct C++/JSI call from Swift at the moment.

### JS-layer TurboModule calls (not Swift, but worth flagging for Android)

- `globalThis.__turboModuleProxy('OnlookRuntimeInstaller').install()` and
  `globalThis.__turboModuleProxy('OnlookInspectorInstaller').install()` are
  the only JS→C++ entry points into the installer surface. The Swift layer
  never invokes them. The Android port needs to register two matching
  TurboModule names (`OnlookRuntimeInstaller`, `OnlookInspectorInstaller`)
  so the shell's `__turboModuleProxy(...)` calls resolve.

### Obj-C modules imported by Swift

Only `FabricEventBootstrap`. No other Obj-C or C++ symbol crosses the Swift
boundary today; Swift never touches the JSI runtime directly.

## Summary for Android port

- 11 translation units (10 `.cpp` + 1 `.mm` whose body is portable)
  compile as-is against Android's NDK + React Native JSI/TurboModule
  headers. These cover the full runtime + inspector skeleton, the
  `install()` logic for both TurboModules, prewarm, version, and the
  error surface.
- 2 iOS-only `.mm` files need Android equivalents for inspector
  functionality:
  - `OnlookInspector_highlight.mm` — overlay rendering via Kotlin/JNI.
  - `OnlookInspector_screenshot.mm` — screenshot capture via PixelCopy + JNI.
- 2 iOS-only `.mm` wrappers need Android equivalents for module registration:
  - `OnlookRuntimeInstaller.mm` — Kotlin TurboModule wrapper.
  - `OnlookInspectorInstaller.mm` — Kotlin TurboModule wrapper.
- 1 Swift/Obj-C surface is iOS-only but Android already has equivalent
  seams (no port needed on the JS side):
  - `HermesBootstrap.swift` — its job (prepend `onlook-runtime.js` to the
    user bundle) is handled at build time via the Metro serializer; Android
    can either reuse the same baked artifact or adopt the build-time path.
  - `FabricEventBootstrap.{h,mm}` — today a logging placeholder; Android
    will want its own tap-forwarding seam once that body lands.
- Blocker: **MCF8c (Android prebuild + CMake wiring)**. Until the Android
  `app/build.gradle`, `CMakeLists.txt`, and TurboModule codegen entries
  land, none of the portable `.cpp` files actually build on Android.
  Once MCF8c is in, the portable set compiles unchanged; only the 4
  iOS-only `.mm` files (2 inspector bodies + 2 installer wrappers)
  require new Kotlin/JNI counterparts.
