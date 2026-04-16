// Copyright Onlook 2026
//
// FabricEventBootstrap.mm — MC2.5 iOS native-side Fabric
// `registerEventHandler` pre-JS call. Today this is a placeholder
// that logs a marker line; the real `nativeFabricUIManager.registerEventHandler(...)`
// equivalent lands when downstream inspector tasks expose a stable
// native hook (MC4.6's tap forwarder already ships standalone; MC2.15
// prewarm will reveal whether the registration needs to wire a C++
// callback or an Obj-C++ block here).
//
// Why ship a placeholder instead of the real body?
// The runtime's `packages/mobile-preview/runtime/shell.js:111` already
// calls `nativeFabricUIManager.registerEventHandler(...)` from JS, so
// taps flow end-to-end without this file. Landing the native hook-point
// now gives downstream work (MC4.6 tap forwarder, MC2.15 prewarm) a
// known native seam to call through to — so later tasks don't have to
// thread a new call-site through AppDelegate under time pressure. The
// actual Fabric API surface we need ends up obvious once MC4.6's
// `+forwardTap:reactTag:source:` has a live Fabric commit handler
// calling into it.
//
// Wave 2 task MC2.5 of plans/onlook-mobile-client-task-queue.md.

#import "FabricEventBootstrap.h"

#import <Foundation/Foundation.h>
#import <os/log.h>

// Guarded import: `RCTLog.h` is not strictly needed by the placeholder
// body (we use `os_log` directly so the marker line lands in Console.app
// even when the RN bridge hasn't finished booting), but including it
// keeps parity with the file header contract promised to downstream
// tasks — the real registration body will need `RCTLog` / `RCTBridge`
// access, so the import stays here as a documented seam.
#if __has_include(<React/RCTLog.h>)
#import <React/RCTLog.h>
#endif

@implementation FabricEventBootstrap

+ (void)registerHandler
{
    // Placeholder: the real Fabric registerEventHandler call lands
    // when we have a stable hook into nativeFabricUIManager from the
    // native side. For now this just logs that the registration pass
    // ran — MC4.6's tap forwarder `+forwardTap:reactTag:source:` is
    // called through from the singleton directly, and the JS-side
    // runtime shell (`packages/mobile-preview/runtime/shell.js`)
    // handles the actual `nativeFabricUIManager.registerEventHandler`
    // invocation until we finalize the native API surface.
    os_log(OS_LOG_DEFAULT,
           "[onlook-runtime] Fabric event bootstrap registered "
           "(placeholder — runtime/shell.js handles actual registration "
           "for now; real body lands in MC2.5 follow-up)");
}

@end
