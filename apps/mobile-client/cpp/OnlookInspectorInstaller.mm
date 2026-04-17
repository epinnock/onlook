// Copyright Onlook 2026
//
// OnlookInspectorInstaller.mm — Obj-C++ wrapper that exposes the C++
// `onlook::OnlookInspectorInstaller` TurboModule to RN's module registry
// under the name `OnlookInspectorInstaller`. See OnlookInspectorInstaller.h
// for the C++ side and the shared module contract.
//
// Wave 4 task MC4.1 of plans/onlook-mobile-client-task-queue.md. Under
// bridgeless / new-arch mode (newArchEnabled: true in app.config), RN's
// `RCTTurboModuleManager` resolves the module by class name using
// `RCTGetModuleClasses()` — which is populated by `RCT_EXPORT_MODULE`.
// Once located, the manager calls `-getTurboModule:` on a fresh
// instance, wiring the returned `std::shared_ptr<TurboModule>` into the
// JS-side `__turboModuleProxy`. No separate module-provider entry in
// the generated `RCTModuleProviders.mm` is required — the ObjC
// fallback path in `RCTTurboModuleManager._getModuleClassFromName`
// (RN 0.81.6) covers modules registered this way. Same wiring shape as
// OnlookRuntimeInstaller.mm (MC2.3).

#import <Foundation/Foundation.h>

#import <React/RCTBridgeModule.h>
#import <ReactCommon/RCTTurboModule.h>

#include "OnlookInspectorInstaller.h"

@interface OnlookInspectorInstaller : NSObject <RCTBridgeModule, RCTTurboModule>
@end

@implementation OnlookInspectorInstaller

// Registers this class with RN's module registry under the name
// `OnlookInspectorInstaller` so `globalThis.__turboModuleProxy(name)`
// (and `TurboModuleRegistry.get`) can locate it.
RCT_EXPORT_MODULE(OnlookInspectorInstaller)

// `install` is exposed to JS via the C++ side's methodMap_; declaring it
// here is optional for pure-C++ TurboModules (the TurboCxxModule path
// handles method dispatch), but the RCT_EXTERN_METHOD annotation keeps
// RN's bridge / dev-menu introspection happy and makes the module
// self-documenting when inspected from Xcode.
RCT_EXTERN_METHOD(install)

// Returns the C++ TurboModule. Called by RCTTurboModuleManager once per
// module per runtime; the returned shared_ptr is cached so a subsequent
// `__turboModuleProxy('OnlookInspectorInstaller')` reuses the same
// instance.
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:
    (const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<onlook::OnlookInspectorInstaller>(params.jsInvoker);
}

@end
