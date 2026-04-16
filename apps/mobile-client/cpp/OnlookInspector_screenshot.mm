// Copyright Onlook 2026
//
// OnlookInspector_screenshot.mm — Obj-C++ TU that implements the iOS body of
// `OnlookInspector.captureScreenshot()`. Lives in its own TU — not inside
// OnlookInspector.cpp — so the MC4.2 / MC4.3 / MC4.4 / MC4.5 tasks land
// their method bodies concurrently without rebase fights on a single hot
// file, mirroring the MC4.5 highlight.mm split. OnlookInspector::
// captureScreenshot in OnlookInspector.cpp is a short delegator (arg
// validation + call) that forwards to `onlook::captureScreenshotImpl`
// declared in OnlookInspector.h; everything UIKit-specific stays confined
// to this file so the shared C++ TU stays buildable on Android too.
//
// Wave 4 task MC4.4 of plans/onlook-mobile-client-task-queue.md.
//
// ──────────────────────────────────────────────────────────────────────────
// Behavior contract (see OnlookInspector.h header for the JS-visible
// contract):
//
//   captureScreenshotImpl(rt)
//     1. Locates the current key UIWindow via `UIApplication.connectedScenes`
//        (iOS 15+ scene API — `UIApplication.keyWindow` is deprecated and
//        unavailable under scene lifecycle). Mirrors `findKeyWindow()` in
//        OnlookInspector_highlight.mm.
//
//     2. Renders the key window into a `UIImage` using
//        `UIGraphicsImageRenderer` sized to the window's bounds. The
//        renderer's format is derived via `rendererFormat` so we pick up
//        the device scale (Retina) and the correct color space — producing
//        an image that matches what the user sees on screen, not a 1x
//        downsample. `drawViewHierarchyInRect:afterScreenUpdates:YES`
//        ensures any pending Fabric commits have flushed into the
//        render-server before the capture.
//
//     3. Converts the image to PNG bytes via `UIImagePNGRepresentation`
//        (iOS API defined in UIKit; no need for Core Graphics dance). PNG
//        is chosen over JPEG for lossless pixel fidelity — the editor's
//        preview thumbnail + diffing flows (see OnlookInspector.h for the
//        public-API contract) compare pixel-exact bytes, so any JPEG
//        quantization would bust diff stability.
//
//     4. Base64-encodes the PNG bytes via
//        `-[NSData base64EncodedStringWithOptions:0]` (Foundation API —
//        no need to hand-roll). Returns the result as a `jsi::String`
//        back to the JS thread. The editor-side receiver wraps this in
//        a `data:image/png;base64,` URL prefix before rendering into an
//        `<img>` — keeping the prefix out of the native payload lets
//        callers reuse the raw bytes for hashing / comparison without
//        stripping the prefix.
//
// Errors → jsi::JSError:
//   - "no key window" when `findKeyWindow()` returns nil (can happen
//     during rotation / split-view transitions before any scene claims
//     key). The editor retries on a short debounce.
//   - "PNG encode failed" when `UIImagePNGRepresentation` returns nil
//     (rare — would indicate the image was empty, e.g., a zero-bounds
//     window). Surfaced loudly instead of returning an empty string so
//     the relay log attributes the failure.
//
// Threading:
//   The JSI boundary runs on the JS thread. UIKit rendering MUST happen
//   on main. We `dispatch_sync` to main for the window lookup + render
//   pass so the call returns with the image bytes already captured — the
//   base64 encode happens back on the JS thread after dispatch_sync
//   returns, which is safe (NSData base64 is thread-safe and not
//   UIKit-bound). `dispatch_sync` from JS → main is safe here because
//   Fabric mounting already completed on main; we can't deadlock against
//   ourselves. Mirrors the pattern in OnlookInspector_highlight.mm.

#import <Foundation/Foundation.h>
#import <UIKit/UIKit.h>

#include "OnlookInspector.h"

#include <jsi/jsi.h>

#include <string>

namespace onlook {

namespace jsi = facebook::jsi;

namespace {

// Locate the key UIWindow across connected scenes. UIApplication.keyWindow
// is deprecated under the scene lifecycle (iOS 13+, enforced 15+), so scan
// `connectedScenes` for a foreground-active `UIWindowScene` and return its
// key window. Falls back to the first foreground-active window if none
// claim key (can happen during rotation / split-view transitions). Mirrors
// findKeyWindow in OnlookInspector_highlight.mm — duplicated here rather
// than shared so each platform TU stays self-contained and the highlight
// TU's header isn't a dependency on the screenshot path.
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

}  // namespace

// ── Public free function. Declared in OnlookInspector.h; called from
//    OnlookInspector::captureScreenshot after arg validation. ──────────

jsi::Value captureScreenshotImpl(jsi::Runtime& rt) {
  // Window lookup + render happens on main; the resulting PNG bytes are
  // captured into an `__block NSData*` so we can base64-encode them back
  // on the JS thread after dispatch_sync returns. Any error message is
  // captured into a local string and re-thrown as jsi::JSError on the JS
  // thread (JSErrors must be thrown there, not on main).
  __block NSData* pngData = nil;
  __block std::string errorMessage;
  dispatch_sync(dispatch_get_main_queue(), ^{
    UIWindow* window = findKeyWindow();
    if (!window) {
      errorMessage =
          "OnlookInspector.captureScreenshot: no key window (app not "
          "foreground-active?)";
      return;
    }
    const CGRect bounds = window.bounds;
    if (CGRectIsEmpty(bounds)) {
      errorMessage =
          "OnlookInspector.captureScreenshot: key window has zero bounds";
      return;
    }

    // Wrap the render + PNG encode in an autoreleasepool so the
    // intermediate UIImage (and any autoreleased temporaries from
    // drawViewHierarchyInRect:/UIImagePNGRepresentation) are released
    // promptly rather than waiting for the main runloop to drain. The
    // resulting NSData is retained by the __block pngData assignment so
    // it survives past the pool scope.
    @autoreleasepool {
      // Build a renderer sized to the window in its native scale so the
      // capture matches on-screen pixel dimensions. Using the default
      // `rendererFormat` picks up the screen's scale + color space.
      UIGraphicsImageRendererFormat* format =
          [UIGraphicsImageRendererFormat preferredFormat];
      UIGraphicsImageRenderer* renderer =
          [[UIGraphicsImageRenderer alloc] initWithSize:bounds.size
                                                 format:format];
      UIImage* image = [renderer
          imageWithActions:^(UIGraphicsImageRendererContext* _Nonnull ctx) {
            (void)ctx;
            // afterScreenUpdates:YES flushes any pending Fabric commits so
            // the capture reflects the latest mount state, not a stale
            // frame. This is slightly more expensive than NO but matches
            // the editor's "what the user sees right now" contract.
            [window drawViewHierarchyInRect:bounds afterScreenUpdates:YES];
          }];

      NSData* data = UIImagePNGRepresentation(image);
      if (!data) {
        errorMessage =
            "OnlookInspector.captureScreenshot: PNG encode failed (empty "
            "image?)";
        return;
      }
      pngData = data;
    }
  });

  if (!errorMessage.empty()) {
    throw jsi::JSError(rt, errorMessage);
  }
  if (!pngData) {
    // Should never happen — either errorMessage is set or pngData is
    // non-nil — but be defensive so we never return an empty string.
    throw jsi::JSError(
        rt,
        "OnlookInspector.captureScreenshot: internal error (no bytes, no "
        "error)");
  }

  NSString* base64 = [pngData base64EncodedStringWithOptions:0];
  return jsi::String::createFromUtf8(rt, [base64 UTF8String]);
}

}  // namespace onlook
