//
// Use this file to import your target's public headers that you would like to expose to Swift.
//

// MC2.5 — exposes the placeholder Fabric event bootstrap class to
// Swift so `AppDelegate.application(_:didFinishLaunchingWithOptions:)`
// can call `FabricEventBootstrap.registerHandler()` after the React
// Native factory has started.
#import "FabricEventBootstrap.h"
