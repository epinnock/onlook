# `apps/mobile-client/cpp/` — Platform-neutral C++ TUs

All `.cpp` translation units in this directory are **platform-neutral** and
depend only on:

- `<jsi/jsi.h>` (Hermes-provided on both iOS and Android)
- `ReactCommon/CallInvoker.h` + `ReactCommon/TurboModule.h` (RN core, both
  platforms)
- C++ standard library (`<memory>`, `<string>`, `<vector>`, `<stdexcept>`)

No `.cpp` in this tree includes Foundation / UIKit / `<React/*>` headers, uses
`NSString*` / `UIView*` / other Obj-C types, or calls into the Obj-C runtime.
iOS-specific work — UIKit overlay drawing, Obj-C++ `RCT_EXPORT_MODULE` glue —
lives exclusively in sibling `.mm` files that are compiled only for iOS.

This matches the posture declared in **MC2.2a** of the task queue: the TUs
themselves are Android-ready; CMake just needs to pick them up when MCF8c
(Android prebuild + Gradle + CMake) lands.

## Audit: MC2.2.1 (2026-04-11)

| TU | Role | Obj-C / iOS code? | Notes |
|----|------|-------------------|-------|
| `OnlookRuntime.cpp` | `jsi::HostObject` dispatch table for `globalThis.OnlookRuntime` (get/set/getPropertyNames + 1-line delegates to per-method impls) | None | Pure JSI |
| `OnlookRuntime_runApplication.cpp` | `runApplicationImpl` — eval user bundle + call `globalThis.onlookMount(props)` | None | Pure JSI |
| `OnlookRuntime_reloadBundle.cpp` | `reloadBundleImpl` — call `globalThis.onlookUnmount()` then re-runApplication | None | Pure JSI |
| `OnlookRuntime_dispatchEvent.cpp` | `dispatchEventImpl` — fan `{name, payload}` through `globalThis.__onlookEventBus.dispatch` | None | Pure JSI |
| `OnlookRuntime_version.cpp` | `getRuntimeVersion()` — stringifies the generated `ONLOOK_RUNTIME_VERSION_STRING` macro | None | Pure C++ + generated header |
| `OnlookRuntimeInstaller.cpp` | `TurboModule` that creates `OnlookRuntime` host object and installs it as a locked property on `globalThis` | None | Logs through Hermes' `nativeLoggingHook` (platform-neutral); no os_log / `__android_log_print` linkage |
| `OnlookInspector.cpp` | `jsi::HostObject` for `globalThis.OnlookInspector` (captureTap wired, walkTree / captureScreenshot / highlightNode skeletons) | None | `highlightNode` dispatches to `highlightNodeImpl` declared in the header; iOS impl of that free function is in `OnlookInspector_highlight.mm` — Android will get a sibling `.cpp` (or a `.mm` equivalent compiled via NDK) when MC4.5 lands Android-side |
| `OnlookInspectorInstaller.cpp` | `TurboModule` that installs `OnlookInspector` on `globalThis` | None | Mirror of `OnlookRuntimeInstaller.cpp`; logs through `nativeLoggingHook` |
| `InspectorPrewarm.cpp` | `prewarmInspector(rt)` — issues `nativeFabricUIManager.findNodeAtPoint(-1, -1)` after install to absorb ~150ms JIT warm-up | None | Pure JSI |

**Result: 9 / 9 TUs clean. 0 TUs need refactoring for Android.**

## iOS-only `.mm` siblings

These files wrap the C++ TUs above with Obj-C++ glue required by the iOS RN
runtime. They are compiled only by the Xcode project; CMake on Android must
**not** pick them up.

| `.mm` file | Wraps | Purpose |
|------------|-------|---------|
| `OnlookRuntimeInstaller.mm` | `OnlookRuntimeInstaller.cpp` | `RCT_EXPORT_MODULE(OnlookRuntimeInstaller)` + `getTurboModule:` factory so RN 0.81's `RCTTurboModuleManager` can discover the C++ TurboModule via its ObjC fallback. See `plans/adr/MC2.3-runtime-installer-hook.md`. |
| `OnlookInspectorInstaller.mm` | `OnlookInspectorInstaller.cpp` | Mirror of the above for the inspector installer (MC4.1). |
| `OnlookInspector_highlight.mm` | Provides `highlightNodeImpl` declared in `OnlookInspector.h` | UIKit overlay drawing for `OnlookInspector.highlightNode(reactTag, color)` (MC4.5). Uses `UIView` / `CAShapeLayer` / main-thread dispatch. Android will need a parallel JNI-backed `highlightNodeImpl` that renders through the Android `View` / `ViewGroup` overlay API when MC4.5-android lands. |

## Android pickup plan (when MCF8c ships)

CMake on the Android side needs to:

1. Compile all 9 `.cpp` files in this directory into a shared library
   (likely `libonlook_runtime.so`), linking against the Hermes JSI library
   and the `reactnative` (CallInvoker + TurboModule) prebuilt from the RN
   gradle module.
2. **Skip** the 3 `.mm` files — they are Obj-C++ and iOS-only. A `file(GLOB
   ... *.cpp)` that does not also glob `*.mm` is sufficient. Recommended to
   list the `.cpp` files explicitly in `CMakeLists.txt` to avoid accidental
   Obj-C++ inclusion via glob surprises.
3. Supply Android-specific `highlightNodeImpl` (MC4.5-android) + JNI
   installer entry points (MC2.4, MC2.6) as additional `.cpp` files under
   `apps/mobile-client/android/app/src/main/cpp/` — those files include
   these TUs' headers but live outside `apps/mobile-client/cpp/` so the
   platform-neutrality invariant of this directory is preserved.

No `.cpp` in this directory needs to change when Android is activated. If a
future edit introduces a platform-specific call site, split it into a
sibling `.mm` (for iOS) or `.cpp` under `android/app/src/main/cpp/` (for
Android) and keep this directory JSI-only.
