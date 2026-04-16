// Copyright Onlook 2026
//
// FabricEventBootstrap.h — header exposing the MC2.5 Fabric event
// registration placeholder to Swift (via the bridging header).
//
// The real body lives in `FabricEventBootstrap.mm`; see that file for
// the rationale for landing a placeholder now vs a full
// `nativeFabricUIManager.registerEventHandler` call-site.

#import <Foundation/Foundation.h>

NS_ASSUME_NONNULL_BEGIN

@interface FabricEventBootstrap : NSObject

// Invoked from `AppDelegate.application(_:didFinishLaunchingWithOptions:)`
// after `factory.startReactNative(...)`. Today this is a logging stub
// that proves the native-side registration pass ran; the Fabric handler
// body lands in a follow-up once downstream inspector tasks (MC4.6's
// tap forwarder, MC2.15 prewarm) surface the exact API we need to hook.
+ (void)registerHandler;

@end

NS_ASSUME_NONNULL_END
