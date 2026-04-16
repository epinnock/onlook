// Copyright Onlook 2026
//
// OnlookInspector_highlight.mm — Obj-C++ TU that implements the iOS body of
// `OnlookInspector.highlightNode(reactTag, color)`. Lives in its own TU —
// not inside OnlookInspector.cpp — so the MC4.2 / MC4.3 / MC4.4 tasks can
// land their method bodies concurrently without rebase fights on a single
// hot file. OnlookInspector::highlightNode in OnlookInspector.cpp is a
// short delegator (arg validation + call) that forwards to
// `onlook::highlightNodeImpl` declared in OnlookInspector.h; everything
// UIKit-specific stays confined to this file so the shared C++ TU stays
// buildable on Android too.
//
// Wave 4 task MC4.5 of plans/onlook-mobile-client-task-queue.md.
//
// ──────────────────────────────────────────────────────────────────────────
// Behavior contract (see OnlookInspector.h header for the JS-visible
// contract):
//
//   highlightNodeImpl(rt, reactTag, colorHex)
//     1. Resolves `reactTag` → `UIView*`. Under Fabric / new-arch (which is
//        the only mode the Onlook Mobile Client ships — see app.config.ts
//        `newArchEnabled: true`), Fabric component views live in an
//        `RCTComponentViewRegistry` that's owned by the Fabric mounting
//        manager. The public lookup path is
//        `-[RCTComponentViewRegistry findComponentViewWithTag:]` which
//        takes the integer reactTag Fabric stamped onto the ShadowNode and
//        returns the backing `UIView<RCTComponentViewProtocol>*`. We reach
//        the registry off the key window's responder chain (a mounted
//        RCTFabricSurface vends a `surfacePresenter` whose
//        `mountingManager.componentViewRegistry` is the thing we want) and
//        fall back to the legacy `-[RCTUIManager viewForReactTag:]` path
//        so the inspector still works against paper-mode shim views.
//        Last-ditch fallback: walk the key window's subtree looking for a
//        view whose `reactTag` matches — slow but covers the "presenter
//        not exposed to AppDelegate yet" bootstrap window.
//
//     2. Parses `colorHex` — "#RRGGBB", "#RRGGBBAA", "#RGB", or the
//        three-letter shorthand / the leading-'#'-less variants. Rejects
//        any other shape (including rgba(…) strings — the caller is the
//        editor's highlight dispatcher MC4.17 which always emits a
//        normalized hex string). Invalid input throws a JSError so the
//        relay surfaces the failure loudly instead of silently dropping
//        the overlay.
//
//     3. Creates an overlay UIView sized to the target's bounds-in-window,
//        with a 2-pt solid border in the parsed color (the queue entry
//        said "2px" — iOS border widths are points; 2pt renders as 2px on
//        @1x, 4px on @2x, 6px on @3x, matching what a designer measures
//        in the editor). The overlay is added to the target's UIWindow —
//        not the target itself — so it doesn't perturb the Fabric
//        hierarchy (MC4.3's walkTree would otherwise see it as a sibling).
//        `userInteractionEnabled = NO` so taps still hit the target
//        underneath; the 600ms UIView animation fades alpha 1→0 and
//        removes the overlay on completion. Bounds are re-derived via
//        `-convertRect:toView:` because Fabric views can be nested under
//        transform / shadow layers that don't share origin with the
//        window.
//
//     4. Returns `jsi::Value::undefined()` — highlight is fire-and-forget
//        from the JS side; the editor treats MC4.17's dispatch as
//        best-effort UI feedback.
//
// Errors → jsi::JSError:
//   - "invalid color" when parseHex returns nil (malformed hex / rgba(…)).
//   - "reactTag N not mounted" when neither Fabric nor legacy lookup
//     returns a view.
//   - "reactTag N has no window" when the view exists but isn't in a
//     window yet (e.g., off-screen during a transition).
//
// Threading:
//   The JSI boundary runs on the JS thread. UIKit calls MUST happen on
//   main. We `dispatch_sync` to main for the lookup + overlay insertion
//   so the call returns with the error state already resolved — the
//   animation itself is scheduled asynchronously on main and doesn't
//   block the JS thread further. `dispatch_sync` from JS → main is safe
//   here because Fabric mounting already completed on main; we can't
//   deadlock against ourselves.

#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>

// Fabric / new-arch component registry. These headers land via the
// `React-Fabric` pod pulled in through autolinked `react-native`. Behind a
// __has_include guard so a future RN drop that renames them still compiles
// — the legacy-UIManager path below carries the lookup.
#if __has_include(<React/RCTSurfacePresenter.h>)
#import <React/RCTSurfacePresenter.h>
#define ONLOOK_HAS_FABRIC 1
#endif
#if __has_include(<React/RCTComponentViewRegistry.h>)
#import <React/RCTComponentViewRegistry.h>
#endif
#if __has_include(<React/RCTMountingManager.h>)
#import <React/RCTMountingManager.h>
#endif

// Legacy paper fallback — still present in RN 0.81.6 even under new-arch
// because some shim views (RCTRootView, modal hosts) register against the
// UIManager. Guarded so a future RN drop that removes it still compiles.
#if __has_include(<React/RCTBridge.h>)
#import <React/RCTBridge.h>
#endif
#if __has_include(<React/RCTUIManager.h>)
#import <React/RCTUIManager.h>
#define ONLOOK_HAS_LEGACY_UIMANAGER 1
#endif

#include "OnlookInspector.h"

#include <jsi/jsi.h>

#include <string>

namespace onlook {

namespace jsi = facebook::jsi;

namespace {

// ── helper: parse "#RRGGBB" / "#RRGGBBAA" / "#RGB" (+ the leading-'#'-less
//    variants) into a UIColor. Returns nil on any malformed input so the
//    caller can raise a JSError with an attributable message. Rejects
//    rgba(…) / hsl(…) / named colors on purpose — the editor's highlight
//    dispatcher (MC4.17) normalizes to hex before sending, so anything
//    else on this channel is a protocol bug we want to surface.
UIColor* _Nullable parseHexColor(const std::string& input) {
  // Strip optional leading '#'.
  std::string hex = input;
  if (!hex.empty() && hex.front() == '#') {
    hex.erase(hex.begin());
  }
  // Validate hex digits only.
  for (char c : hex) {
    const bool isDigit = (c >= '0' && c <= '9');
    const bool isLower = (c >= 'a' && c <= 'f');
    const bool isUpper = (c >= 'A' && c <= 'F');
    if (!isDigit && !isLower && !isUpper) {
      return nil;
    }
  }
  // Expand 3-char shorthand ("f0a" → "ff00aa").
  if (hex.length() == 3) {
    std::string expanded;
    expanded.reserve(6);
    for (char c : hex) {
      expanded.push_back(c);
      expanded.push_back(c);
    }
    hex = expanded;
  }
  if (hex.length() != 6 && hex.length() != 8) {
    return nil;
  }
  auto parseByte = [](const std::string& s, size_t offset) -> CGFloat {
    const char hi = s[offset];
    const char lo = s[offset + 1];
    auto nibble = [](char c) -> int {
      if (c >= '0' && c <= '9') return c - '0';
      if (c >= 'a' && c <= 'f') return 10 + (c - 'a');
      if (c >= 'A' && c <= 'F') return 10 + (c - 'A');
      return 0;
    };
    return (CGFloat)((nibble(hi) << 4) | nibble(lo)) / 255.0;
  };
  CGFloat r = parseByte(hex, 0);
  CGFloat g = parseByte(hex, 2);
  CGFloat b = parseByte(hex, 4);
  CGFloat a = (hex.length() == 8) ? parseByte(hex, 6) : 1.0;
  return [UIColor colorWithRed:r green:g blue:b alpha:a];
}

// Locate the key UIWindow across connected scenes. UIApplication.keyWindow
// is deprecated; scan scene.windows for isKeyWindow instead. Falls back to
// the first foreground-active scene's first window if none claim key (can
// happen during rotation / split-view transitions).
UIWindow* _Nullable findKeyWindow() {
  UIWindow* firstActive = nil;
  for (UIScene* scene in [UIApplication sharedApplication].connectedScenes) {
    if (![scene isKindOfClass:[UIWindowScene class]]) continue;
    UIWindowScene* ws = (UIWindowScene*)scene;
    if (ws.activationState != UISceneActivationStateForegroundActive) continue;
    for (UIWindow* w in ws.windows) {
      if (w.isKeyWindow) return w;
      if (!firstActive) firstActive = w;
    }
  }
  return firstActive;
}

// ── helper: resolve a reactTag → UIView via the Fabric new-arch registry,
//    with a legacy UIManager fallback for old-arch / shim views. Returns
//    nil if no path finds a backing view.
//
//    Must be called on the main thread — both RCTComponentViewRegistry
//    and RCTUIManager assume it. The caller (highlightNodeImpl) hops to
//    main via dispatch_sync before invoking.
UIView* _Nullable findViewForReactTag(NSNumber* tag) {
  UIWindow* keyWindow = findKeyWindow();

#if ONLOOK_HAS_FABRIC
  // Preferred path: Fabric mounting manager owns the component-view
  // registry. We walk the key window's responder chain until we find a
  // responder that vends a `surfacePresenter` (i.e., an RCTFabricSurface-
  // backed view), then drill into
  // `presenter.mountingManager.componentViewRegistry` and invoke
  // `findComponentViewWithTag:` (the RN 0.81.6 selector; older drops use
  // `componentViewByTag:`). All calls go through NSObject
  // `respondsToSelector:` / `performSelector:` so this TU compiles
  // cleanly against either pod version without a RN-version conditional
  // that would have to bump on every upgrade.
  NSMutableArray<UIView*>* roots = [NSMutableArray array];
  if (keyWindow) {
    [roots addObject:keyWindow];
    for (UIView* sub in keyWindow.subviews) [roots addObject:sub];
  }
  for (UIView* root in roots) {
    UIResponder* resp = root;
    while (resp) {
      if ([resp respondsToSelector:@selector(surfacePresenter)]) {
        id presenter = [resp performSelector:@selector(surfacePresenter)];
        if ([presenter respondsToSelector:@selector(mountingManager)]) {
          id mountingManager =
              [presenter performSelector:@selector(mountingManager)];
          if ([mountingManager
                  respondsToSelector:@selector(componentViewRegistry)]) {
            id registry = [mountingManager
                performSelector:@selector(componentViewRegistry)];
            SEL findSel = @selector(findComponentViewWithTag:);
            if (![registry respondsToSelector:findSel]) {
              findSel = @selector(componentViewByTag:);
            }
            if ([registry respondsToSelector:findSel]) {
              id found = [registry performSelector:findSel withObject:tag];
              if ([found isKindOfClass:[UIView class]]) {
                return (UIView*)found;
              }
            }
          }
        }
        break;
      }
      resp = resp.nextResponder;
    }
  }
#endif

#if ONLOOK_HAS_LEGACY_UIMANAGER
  // Legacy paper fallback — `RCTUIManager viewForReactTag:` needs the
  // active RCTBridge. Under bridgeless mode the shared bridge is still
  // vended through `-[RCTBridge currentBridge]` for compatibility.
  RCTBridge* bridge = [RCTBridge currentBridge];
  if (bridge) {
    RCTUIManager* uiManager = [bridge moduleForClass:[RCTUIManager class]];
    if ([uiManager respondsToSelector:@selector(viewForReactTag:)]) {
      UIView* view = [uiManager viewForReactTag:tag];
      if (view) return view;
    }
  }
#endif

  // Last-ditch brute-force scan: walk the key window's view tree and
  // match on the `reactTag` property that RCTComponentView sets on every
  // Fabric-mounted view. Slow (O(N) in the view count) but covers the
  // "Fabric presenter lookup failed but the view is actually mounted"
  // case that shows up on app launch before the surface is handed back.
  if (keyWindow) {
    NSMutableArray<UIView*>* stack =
        [NSMutableArray arrayWithObject:keyWindow];
    while (stack.count > 0) {
      UIView* v = [stack lastObject];
      [stack removeLastObject];
      if ([v respondsToSelector:@selector(reactTag)]) {
        NSNumber* vt = [v performSelector:@selector(reactTag)];
        if ([vt isKindOfClass:[NSNumber class]] &&
            [vt isEqualToNumber:tag]) {
          return v;
        }
      }
      for (UIView* child in v.subviews) {
        [stack addObject:child];
      }
    }
  }
  return nil;
}

}  // namespace

// ── Public free function. Declared in OnlookInspector.h; called from
//    OnlookInspector::highlightNode after arg validation. ───────────────

jsi::Value highlightNodeImpl(
    jsi::Runtime& rt,
    int reactTag,
    std::string colorHex) {
  UIColor* color = parseHexColor(colorHex);
  if (!color) {
    throw jsi::JSError(
        rt,
        "OnlookInspector.highlightNode: invalid color '" + colorHex +
            "' — expected #RRGGBB, #RRGGBBAA, or #RGB");
  }

  NSNumber* tagNumber = [NSNumber numberWithInt:reactTag];

  // Lookup + overlay insertion happens on main; any error message is
  // captured into a local string and re-thrown as jsi::JSError after
  // dispatch_sync returns (JSErrors must be thrown on the JS thread).
  __block std::string errorMessage;
  dispatch_sync(dispatch_get_main_queue(), ^{
    UIView* target = findViewForReactTag(tagNumber);
    if (!target) {
      errorMessage = std::string(
                         "OnlookInspector.highlightNode: reactTag ") +
          std::to_string(reactTag) + " not mounted";
      return;
    }
    UIWindow* window = target.window;
    if (!window) {
      errorMessage = std::string(
                         "OnlookInspector.highlightNode: reactTag ") +
          std::to_string(reactTag) + " has no window (off-screen?)";
      return;
    }

    // Compute target bounds expressed in window coordinates so the
    // overlay lands on top of it regardless of scroll / transform state.
    CGRect frameInWindow = [target convertRect:target.bounds toView:window];

    UIView* overlay = [[UIView alloc] initWithFrame:frameInWindow];
    overlay.backgroundColor = [UIColor clearColor];
    overlay.userInteractionEnabled = NO;
    overlay.layer.borderWidth = 2.0;
    overlay.layer.borderColor = color.CGColor;
    overlay.accessibilityIdentifier = @"onlook.highlight";

    [window addSubview:overlay];

    [UIView animateWithDuration:0.6
                          delay:0.0
                        options:UIViewAnimationOptionCurveEaseOut |
                                UIViewAnimationOptionAllowUserInteraction
                     animations:^{
                       overlay.alpha = 0.0;
                     }
                     completion:^(BOOL /*finished*/) {
                       [overlay removeFromSuperview];
                     }];
  });

  if (!errorMessage.empty()) {
    throw jsi::JSError(rt, errorMessage);
  }
  return jsi::Value::undefined();
}

}  // namespace onlook
