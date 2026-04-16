// Copyright Onlook 2026
//
// OnlookTapForwarder.mm — Obj-C++ RN event-emitter module that forwards
// native taps on the Fabric root view up to JS. Registers with the RN
// module registry under the name `OnlookTapForwarder`; on the JS side
// MC4.14's `tapHandler.ts` subscribes to its `onlookTap` event via
// `NativeEventEmitter(NativeModules.OnlookTapForwarder)` and turns each
// emission into an `onlook:select` relay message.
//
// Wave 4 task MC4.6 of plans/onlook-mobile-client-task-queue.md. The
// Fabric-side wiring that actually *invokes* `+forwardTap:reactTag:source:`
// from a mounted root view is owned by MC2.5 (Fabric
// `registerEventHandler` pre-JS call, in flight). This file ships as a
// standalone component — the class method is callable from any Obj-C++
// translation unit that imports `OnlookTapForwarder.h`-equivalent; when
// MC2.5 lands its handler registration it can forward taps via:
//
//   #import "OnlookTapForwarder.mm"  // or equivalent header
//   [OnlookTapForwarder forwardTap:point reactTag:tag source:srcDict];
//
// The `source` dict is the passthrough for MC4.12's Sucrase `jsx-source`
// `__source` metadata ({ fileName, lineNumber, columnNumber }) plucked
// off `props.__source` by the Fabric tap handler. JS-side MC4.14
// normalizes the dict via `extractSource` before building the wire
// `SelectMessage`.

#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>

#import <React/RCTBridgeModule.h>
#import <React/RCTEventEmitter.h>

@interface OnlookTapForwarder : RCTEventEmitter <RCTBridgeModule>
@end

@implementation OnlookTapForwarder {
    // Tracks whether JS has a NativeEventEmitter subscription active.
    // `RCTEventEmitter` toggles this via `-startObserving` /
    // `-stopObserving`; when no listeners are attached we short-circuit
    // `sendEventWithName:` to avoid RN's "Sending `onlookTap` with no
    // listeners registered" warning during early boot (before MC4.14's
    // handler has mounted).
    BOOL _hasListeners;
}

// Registers this class with RN's module registry. Lookup is by class
// name so `NativeModules.OnlookTapForwarder` resolves to the singleton
// instance RN retains internally. Exported as an Obj-C bridge module
// (not a TurboModule) because `RCTEventEmitter`'s pub-sub protocol is
// the simplest path for a fire-and-forget native→JS event channel and
// doesn't benefit from Turbo's sync call semantics. Same pattern as
// RN's built-in `RCTDeviceEventEmitter`.
RCT_EXPORT_MODULE(OnlookTapForwarder)

// RN's bridge calls this to decide which queue to invoke module methods
// on. For an event emitter the work is trivial (build an NSDictionary +
// call super), so we opt into main-queue setup — this also means the
// module instance is available synchronously to the Fabric commit-phase
// code path that MC2.5 will wire, without having to hop through
// `dispatch_async`.
+ (BOOL)requiresMainQueueSetup
{
    return YES;
}

// Declares the event names JS may subscribe to. RN validates
// `sendEventWithName:` calls against this list — emitting an unknown
// name is a hard error (throws in dev). Keeping it to a single
// `onlookTap` event means MC4.14's subscriber has exactly one channel
// to listen on; future inspector signals (e.g. `onlookHover`) would be
// additions here, not renames.
- (NSArray<NSString *> *)supportedEvents
{
    return @[@"onlookTap"];
}

// RN notifies us when the JS-side listener count transitions 0→>0 /
// >0→0 so we can gate `sendEventWithName:`. Without this guard, taps
// fired before MC4.14's `NativeEventEmitter` subscription is live
// would log a spurious warning per tap (and be dropped anyway).
- (void)startObserving
{
    _hasListeners = YES;
}

- (void)stopObserving
{
    _hasListeners = NO;
}

// Singleton accessor. RN's `RCTBridge` retains exactly one instance of
// each exported Obj-C module per bridge, and hands it to us via
// `-init` — we stash it on a static here so `+forwardTap:reactTag:source:`
// can locate the live instance without walking the bridge. The first
// instance wins; subsequent inits (unusual, but possible during a
// bridge reload) refresh the pointer. Access is guarded by `@synchronized`
// to cover the reload-from-background case where the new bridge's
// `-init` may race with the old bridge's final `-invalidate`.
static __weak OnlookTapForwarder *sSharedInstance = nil;

- (instancetype)init
{
    self = [super init];
    if (self) {
        @synchronized([OnlookTapForwarder class]) {
            sSharedInstance = self;
        }
    }
    return self;
}

+ (nullable instancetype)sharedInstance
{
    @synchronized([OnlookTapForwarder class]) {
        return sSharedInstance;
    }
}

// Public entry point used by the Fabric tap handler (MC2.5, landing
// separately). Safe to call from any thread — `sendEventWithName:` is
// documented as thread-safe on `RCTEventEmitter`, and the `body` dict
// is copied before being serialized across the bridge.
//
// Contract:
//   - `point`   — tap location in the root view's coordinate space
//                 (points, not pixels). Forwarded as
//                 `{ x: Number, y: Number }` so JS can correlate with
//                 `findNodeAtPoint` results.
//   - `reactTag` — the Fabric shadow-node tag identified by
//                  `findNodeAtPoint` (MC4.2). Passed to JS as a Number.
//   - `source`   — the `props.__source` dict as plucked by the Fabric
//                  handler from the shadow node's props (MC4.12). May
//                  be nil when the tapped element has no `__source`
//                  (e.g. a host component skipped by the jsx-source
//                  transform); MC4.14's `extractSource` handles both
//                  present-and-valid and missing cases.
//
// Emission shape (JS side):
//   { x, y, reactTag, source: { fileName, lineNumber, columnNumber } | null }
+ (void)forwardTap:(CGPoint)point
          reactTag:(NSInteger)reactTag
            source:(nullable NSDictionary *)source
{
    OnlookTapForwarder *instance = [self sharedInstance];
    if (instance == nil) {
        // Bridge not up yet (pre-mount) or torn down mid-reload.
        // Silently drop — taps are best-effort; the next tap after the
        // bridge comes back will land.
        return;
    }
    if (!instance->_hasListeners) {
        // No JS subscriber yet (MC4.14 hasn't called
        // `NativeEventEmitter.addListener('onlookTap', …)`). Drop
        // rather than emit a warning — this is expected during the
        // window between native mount and JS handler registration.
        return;
    }

    NSDictionary *body = @{
        @"x": @(point.x),
        @"y": @(point.y),
        @"reactTag": @(reactTag),
        // Pass `NSNull` (bridges to `null`) when source is absent so
        // the JS-side `extractSource` hits its null-guard path instead
        // of dereferencing undefined.
        @"source": source ?: (id)[NSNull null],
    };

    [instance sendEventWithName:@"onlookTap" body:body];
}

@end
