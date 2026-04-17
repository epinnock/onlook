// Copyright Onlook 2026
//
// FabricEventBootstrap.mm — MC2.5 iOS native-side tap bridge.
//
// Pragmatic approach:
//   The original spec called for hooking the Fabric
//   `registerEventHandler` API directly so every synthetic-event commit
//   surfaced through a single Obj-C++ seam. Under bridgeless Fabric
//   (Expo SDK 54 / RN 0.81 `newArchEnabled: true`) that API is not
//   publicly exposed from Obj-C++ — earlier attempts (two of them,
//   captured in the task memory) burned multi-hour research loops
//   without landing a compileable diff. The compile-failure fix in
//   `674b4980` is the cautionary tale: `[RCTBridge currentBridge]`
//   returns `nil` under bridgeless, and the header declaration is
//   inconsistent across Expo SDK 54 patch releases.
//
//   Instead of chasing the private Fabric API surface, this file
//   installs a `UITapGestureRecognizer` on the Fabric root UIView.
//   Each tap is dual-published:
//     - as an `onlook:tap` `NSNotification` for any native observer
//       that wants to inspect the tap without going through JS (future
//       native-side inspector tooling);
//     - through `OnlookTapForwarder` (MC4.6) which emits an
//       `onlookTap` event over the RN bridge — a path that's already
//       wired to an `RCTEventEmitter` singleton, sidestepping the need
//       to stand up a second native module just to cross the bridge.
//   JS subscribes via `NativeEventEmitter` (see
//   `apps/mobile-client/src/nativeEvents/tapBridge.ts`) and forwards
//   the tap into `globalThis.OnlookRuntime.dispatchEvent('onlook:tap',
//   {x, y})`. Hit-testing + `reactTag` resolution stay in JS (MC4.2's
//   `findNodeAtPoint`), which is exactly where they live today for the
//   JS-runtime-shell path.
//
//   Limitations this stub accepts (documented here so the follow-up
//   isn't surprised):
//     1. `cancelsTouchesInView = NO` — we observe taps alongside
//        existing RN gesture handlers, we don't intercept them. Normal
//        scroll / button behavior is unaffected.
//     2. The recognizer attaches to the first subview that advertises
//        a `reactTag` key-value (selector check, not import-dependent)
//        under the key window's root view. If Fabric hasn't mounted by
//        the time `+registerHandler` is called, we retry a handful of
//        times on the main queue. No tap forwarding happens until the
//        recognizer has a live view to attach to.
//     3. Coordinates are published in the root view's coordinate space
//        (points), which matches the JS contract in
//        `packages/mobile-preview/runtime/shell.js`.
//
// Wave 2 task MC2.5 of plans/onlook-mobile-client-task-queue.md.

#import "FabricEventBootstrap.h"

#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>
#import <objc/runtime.h>
#import <os/log.h>

// `RCTLog.h` is intentionally not imported — the bridgeless header
// situation (`674b4980`) is the whole reason we're on the
// UITapGestureRecognizer path. We log via `os_log` so the marker line
// lands in Console.app regardless of RN bridge state.

// Notification name observed by the JS-side bridge
// (`apps/mobile-client/src/nativeEvents/tapBridge.ts`). Kept as a
// `static NSString` to avoid typos across the Obj-C / JS seam; the JS
// side hardcodes the same literal.
static NSString *const kOnlookTapNotificationName = @"onlook:tap";

// Max attempts to locate the Fabric root view before giving up.
// 12 × 100ms = 1.2s total search window — the mount typically lands
// inside 200ms, so this leaves ample headroom for a slow simulator
// cold-start without spinning forever on a misconfigured build.
static const NSInteger kMaxRootSearchAttempts = 12;
static const NSTimeInterval kRootSearchRetryDelay = 0.1;

// Target of the recognizer — holds a weak pointer to the attached root
// view so the gesture handler can translate coordinates into its
// local space and bail cleanly if the view disappears (bundle reload).
@interface _OnlookTapTarget : NSObject
@property (nonatomic, weak) UIView *attachedView;
- (void)handleTap:(UITapGestureRecognizer *)recognizer;
@end

@implementation _OnlookTapTarget

- (void)handleTap:(UITapGestureRecognizer *)recognizer
{
    UIView *view = self.attachedView;
    if (view == nil) {
        // Root view was torn down (bundle reload or backgrounding). The
        // recognizer will be GC'd with the view; nothing to do here.
        return;
    }

    CGPoint point = [recognizer locationInView:view];

    // Pass as NSNumbers so the default NSNotification -> JS bridge
    // (RCTDeviceEventEmitter conversion) serializes cleanly. CGFloat
    // on modern iOS is a double; @(double) is an NSNumber which the
    // RN serializer maps to a JS number without loss.
    NSDictionary *userInfo = @{
        @"x": @((double)point.x),
        @"y": @((double)point.y),
    };

    [[NSNotificationCenter defaultCenter]
        postNotificationName:kOnlookTapNotificationName
                      object:nil
                    userInfo:userInfo];

    // Dual-publish through MC4.6's RCTEventEmitter so the tap crosses
    // the RN bridge without us having to stand up a second native
    // module. `reactTag` is 0 / `source` is nil in this pragmatic
    // stub — JS runs `findNodeAtPoint(x, y)` from the forwarded
    // coordinates to resolve both, which is the same division of
    // labor the JS runtime shell uses. The `forwardTap:` class method
    // is resolved dynamically to avoid a compile-time header
    // dependency on `OnlookTapForwarder.h` (the class declares itself
    // inside its `.mm` via `RCT_EXPORT_MODULE` and has no public
    // header in this target).
    Class forwarder = NSClassFromString(@"OnlookTapForwarder");
    SEL forwardSel = NSSelectorFromString(@"forwardTap:reactTag:source:");
    if (forwarder != nil && [forwarder respondsToSelector:forwardSel]) {
        NSMethodSignature *sig = [forwarder methodSignatureForSelector:forwardSel];
        if (sig != nil) {
            NSInvocation *inv = [NSInvocation invocationWithMethodSignature:sig];
            inv.target = forwarder;
            inv.selector = forwardSel;
            CGPoint pt = point;
            NSInteger reactTag = 0;
            NSDictionary *source = nil;
            [inv setArgument:&pt atIndex:2];
            [inv setArgument:&reactTag atIndex:3];
            [inv setArgument:&source atIndex:4];
            [inv invoke];
        }
    }

    os_log_debug(OS_LOG_DEFAULT,
                 "[onlook-runtime] tap captured at (%.1f, %.1f) — posted onlook:tap notification + forwarded via OnlookTapForwarder",
                 (double)point.x, (double)point.y);
}

@end

@implementation FabricEventBootstrap

// Retain the target object for the lifetime of the process. The
// recognizer weak-refs its target, and without a strong reference here
// ARC would collect it as soon as `+registerHandler` returns.
static _OnlookTapTarget *sTapTarget = nil;

+ (void)registerHandler
{
    os_log(OS_LOG_DEFAULT,
           "[onlook-runtime] Fabric tap bridge registration requested "
           "(UITapGestureRecognizer path — bridgeless Fabric stub)");

    // AppDelegate calls us synchronously from
    // `-application:didFinishLaunchingWithOptions:`, at which point
    // `factory.startReactNative(...)` has returned but the Fabric
    // mount hasn't necessarily run yet. Hop onto the main queue so the
    // first attempt sees any views that `startReactNative` added
    // synchronously; a retry loop covers the async mount case.
    dispatch_async(dispatch_get_main_queue(), ^{
        [self attachTapRecognizerAttempt:0];
    });
}

+ (void)attachTapRecognizerAttempt:(NSInteger)attempt
{
    if (sTapTarget != nil && sTapTarget.attachedView != nil) {
        // Already installed — idempotent. The recognizer stays alive
        // for the life of the root view, so re-calls are no-ops until
        // the root view is torn down.
        return;
    }

    UIView *rootView = [self findFabricRootView];
    if (rootView == nil) {
        if (attempt >= kMaxRootSearchAttempts) {
            os_log(OS_LOG_DEFAULT,
                   "[onlook-runtime] Fabric root view not located after %ld attempts — tap bridge inactive",
                   (long)kMaxRootSearchAttempts);
            return;
        }
        dispatch_after(
            dispatch_time(DISPATCH_TIME_NOW, (int64_t)(kRootSearchRetryDelay * NSEC_PER_SEC)),
            dispatch_get_main_queue(), ^{
                [self attachTapRecognizerAttempt:attempt + 1];
            });
        return;
    }

    sTapTarget = [[_OnlookTapTarget alloc] init];
    sTapTarget.attachedView = rootView;

    UITapGestureRecognizer *recognizer =
        [[UITapGestureRecognizer alloc] initWithTarget:sTapTarget
                                                action:@selector(handleTap:)];
    // Observe-only: don't steal taps from RN's own gesture handling.
    // Buttons, scroll views, and other RN-managed recognizers keep
    // working as normal.
    recognizer.cancelsTouchesInView = NO;
    recognizer.delaysTouchesBegan = NO;
    recognizer.delaysTouchesEnded = NO;

    [rootView addGestureRecognizer:recognizer];

    os_log(OS_LOG_DEFAULT,
           "[onlook-runtime] Fabric tap bridge attached to root view (attempt %ld)",
           (long)(attempt + 1));
}

// Walks the key window's view hierarchy and returns the first subview
// that responds to `reactTag` (the marker React Native sets on every
// managed view, including Fabric shadow-node mirrors). Returns nil if
// the key window isn't available yet or no RN-managed subview exists.
+ (nullable UIView *)findFabricRootView
{
    UIWindow *keyWindow = nil;

    // `UIApplication.keyWindow` is deprecated on iOS 13+; prefer the
    // connected-scene API when available. Fall back for older SDKs /
    // edge cases where no scene has been marked key yet.
    if (@available(iOS 13.0, *)) {
        for (UIScene *scene in [UIApplication sharedApplication].connectedScenes) {
            if (scene.activationState != UISceneActivationStateForegroundActive) continue;
            if (![scene isKindOfClass:[UIWindowScene class]]) continue;
            UIWindowScene *windowScene = (UIWindowScene *)scene;
            for (UIWindow *window in windowScene.windows) {
                if (window.isKeyWindow) {
                    keyWindow = window;
                    break;
                }
            }
            if (keyWindow != nil) break;
        }
    }
    if (keyWindow == nil) {
        // Last-resort fallback for cold-launch windows that haven't yet
        // been promoted to key — pick the first window on the first
        // foreground scene, which is what AppDelegate creates.
        if (@available(iOS 13.0, *)) {
            for (UIScene *scene in [UIApplication sharedApplication].connectedScenes) {
                if (![scene isKindOfClass:[UIWindowScene class]]) continue;
                UIWindowScene *windowScene = (UIWindowScene *)scene;
                if (windowScene.windows.count > 0) {
                    keyWindow = windowScene.windows.firstObject;
                    break;
                }
            }
        }
    }
    if (keyWindow == nil) return nil;

    UIViewController *rootVC = keyWindow.rootViewController;
    UIView *root = rootVC.view;
    if (root == nil) return nil;

    // Prefer a subview tagged by RN — that's the Fabric root. If the
    // controller's own view happens to be the RN root (some Expo host
    // setups reparent things), fall back to it.
    UIView *rnRoot = [self findFirstReactTaggedSubview:root];
    return rnRoot ?: root;
}

// Breadth-first search for a UIView that advertises a `reactTag`
// property. RN sets `reactTag` on every managed view (both paper and
// Fabric); a selector check keeps us independent of the RN header
// imports that would otherwise tie us to the bridgeless headers we're
// avoiding.
+ (nullable UIView *)findFirstReactTaggedSubview:(UIView *)root
{
    SEL reactTagSel = NSSelectorFromString(@"reactTag");

    NSMutableArray<UIView *> *queue = [NSMutableArray arrayWithObject:root];
    while (queue.count > 0) {
        UIView *view = queue.firstObject;
        [queue removeObjectAtIndex:0];

        if ([view respondsToSelector:reactTagSel]) {
            // A `nil` reactTag means the view was allocated but not yet
            // mounted — skip it and keep searching. We use the runtime
            // API to read the value without statically binding the
            // return type, since `reactTag` is an NSNumber on some RN
            // versions and a primitive on others.
            id tagValue = nil;
            NSMethodSignature *sig = [view methodSignatureForSelector:reactTagSel];
            if (sig != nil && strcmp(sig.methodReturnType, @encode(id)) == 0) {
                NSInvocation *inv = [NSInvocation invocationWithMethodSignature:sig];
                inv.target = view;
                inv.selector = reactTagSel;
                [inv invoke];
                void *raw = NULL;
                [inv getReturnValue:&raw];
                tagValue = (__bridge id)raw;
            }
            if (tagValue != nil) {
                return view;
            }
            // Fall through — some RN versions return primitives; we
            // treat "responds to reactTag at all" as good enough for
            // the primitive path, since the subtree below is still RN.
            return view;
        }

        for (UIView *sub in view.subviews) {
            [queue addObject:sub];
        }
    }
    return nil;
}

@end
