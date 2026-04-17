// Copyright Onlook 2026
//
// FabricEventBootstrap.h — header exposing the MC2.5 tap bridge to
// Swift (via the bridging header).
//
// See `FabricEventBootstrap.mm` for the rationale behind the
// UITapGestureRecognizer approach (bridgeless Fabric registerEventHandler
// is not publicly accessible from Obj-C++ in Expo SDK 54 / RN 0.81).

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface FabricEventBootstrap : NSObject

// Invoked from `AppDelegate.application(_:didFinishLaunchingWithOptions:)`
// after `factory.startReactNative(...)`. Installs a
// `UITapGestureRecognizer` on the Fabric root view and posts each tap
// as an `onlook:tap` `NSNotification` for the JS-side
// `NativeEventEmitter` bridge (see
// `apps/mobile-client/src/nativeEvents/tapBridge.ts`).
//
// Idempotent — repeated calls are no-ops once the recognizer has been
// attached. Safe to call before the Fabric root exists; a bounded
// retry loop on the main queue handles the async-mount case.
+ (void)registerHandler;

@end

NS_ASSUME_NONNULL_END
