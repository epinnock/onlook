// Copyright Onlook 2026
//
// OnlookInspector — JSI host object that exposes the inspector API to user JS
// code running inside the Onlook Mobile Client. Installed on
// `globalThis.OnlookInspector` by the platform-specific installer (iOS:
// OnlookInspectorInstaller.mm, MC4.1; Android: follow-up task once MCF8c
// lands).
//
// Wave 4 task MC4.1 of plans/onlook-mobile-client-task-queue.md. Method
// bodies for `captureTap`, `walkTree`, `captureScreenshot`, and
// `highlightNode` land in MC4.2 / MC4.3 / MC4.4 / MC4.5 respectively. The
// skeleton in OnlookInspector.cpp throws `jsi::JSError("not implemented")`
// for everything until those tasks land.
//
// ──────────────────────────────────────────────────────────────────────────
// Public API surface (consumed by the relay-driven editor inspector)
//
//   OnlookInspector.captureTap(x: number, y: number): { reactTag: number, … }
//     Given a screen-space coordinate pair, returns the topmost Fabric
//     component under the point by calling `findNodeAtPoint` on
//     `nativeFabricUIManager`. Used by the editor's "tap-to-select" gesture
//     forwarded from the relay (see packages/browser-metro/src/host for the
//     coordinate translation). Throws a JSError if Fabric's UI manager is
//     unreachable or no node is hit at the point. MC4.2.
//
//   OnlookInspector.walkTree(reactTag: number): { tag, props, children[] }
//     Walks the shadow tree rooted at `reactTag` using
//     `cloneNodeWithNewChildren` introspection to produce a plain-JS
//     snapshot of the subtree (props, style, `__source` tags). Used by
//     the editor's element tree panel. Payload shape stays stable across
//     the wave; breaking changes bump MC6.1's runtime version. MC4.3.
//
//   OnlookInspector.captureScreenshot(): string (base64 PNG)
//     Renders the currently-mounted root view via
//     `UIView.snapshot(after:afterScreenUpdates:)` (iOS) / the equivalent
//     `PixelCopy.request` path (Android) and returns a base64-encoded PNG.
//     Used by the editor's preview thumbnail + diffing flows. MC4.4.
//
//   OnlookInspector.highlightNode(reactTag: number, color: string): void
//     Draws an overlay rectangle on the native view matching `reactTag`
//     in `color` (hex or rgba string). Non-destructive — the overlay
//     lives in a sibling layer above the Fabric root. Passing `reactTag
//     === 0` clears all highlights. MC4.5.
//
// ──────────────────────────────────────────────────────────────────────────
// Lifetime & threading
//
// One OnlookInspector instance per Hermes runtime — installed by the
// platform installer and held by the host's runtime via the JSI HostObject
// retain mechanism. All methods run on the JS thread; the screenshot /
// tree-walk implementations that need to touch UIKit hop to the main
// thread internally via the RN UIManager queue, then marshal results back
// to JS. Callers do not need to hop manually.

#pragma once

#include <jsi/jsi.h>

#include <memory>
#include <string>

namespace onlook {

/// JSI host object exposing the OnlookInspector API to JS. See file header
/// for the public-API contract. Sits behind `globalThis.OnlookInspector`
/// once the platform installer has registered it.
class OnlookInspector : public facebook::jsi::HostObject {
 public:
  OnlookInspector();
  ~OnlookInspector() override = default;

  // ── facebook::jsi::HostObject protocol ──────────────────────────────────

  /// Returns the JS-visible property for `name`. Method properties
  /// (`captureTap`, `walkTree`, `captureScreenshot`, `highlightNode`)
  /// return a `jsi::Function` host function bound to the corresponding C++
  /// method. Unknown property names return `jsi::Value::undefined()`.
  facebook::jsi::Value get(
      facebook::jsi::Runtime& rt,
      const facebook::jsi::PropNameID& name) override;

  /// Throws `jsi::JSError` — the OnlookInspector API surface is read-only
  /// from JS. This intentionally guards against user code doing
  /// `OnlookInspector.captureTap = function () { ... }` and silently
  /// breaking the editor protocol.
  void set(
      facebook::jsi::Runtime& rt,
      const facebook::jsi::PropNameID& name,
      const facebook::jsi::Value& value) override;

  /// Lists the publicly-readable property names so
  /// `Object.keys(OnlookInspector)` returns the documented surface and JS
  /// reflection works as expected.
  std::vector<facebook::jsi::PropNameID> getPropertyNames(
      facebook::jsi::Runtime& rt) override;

 private:
  // ── per-method implementations (delegated to from `get`'s host-function
  //    closures) — bodies land in MC4.2 / MC4.3 / MC4.4 / MC4.5 ──────────

  facebook::jsi::Value captureTap(
      facebook::jsi::Runtime& rt,
      const facebook::jsi::Value* args,
      size_t count);

  facebook::jsi::Value walkTree(
      facebook::jsi::Runtime& rt,
      const facebook::jsi::Value* args,
      size_t count);

  facebook::jsi::Value captureScreenshot(
      facebook::jsi::Runtime& rt,
      const facebook::jsi::Value* args,
      size_t count);

  facebook::jsi::Value highlightNode(
      facebook::jsi::Runtime& rt,
      const facebook::jsi::Value* args,
      size_t count);
};

// ── platform-specific method implementations declared here as free
//    functions so the iOS UIKit / Android View bodies can live in their
//    own TUs without creating rebase pressure on the shared C++ host
//    object. MC4.5 / MCF8c (Android mirror) wire these up. Each platform
//    TU defines the function; OnlookInspector::<method> in
//    OnlookInspector.cpp is a thin delegator that handles arg validation
//    before handing off to the free function.

/// MC4.5 — draw a 2pt overlay border on the UIView backing `reactTag` in
/// `colorHex` (e.g. "#FF0000") and fade it out over 600ms. Throws
/// `jsi::JSError` on invalid color, unmounted reactTag, or a view that
/// isn't yet in a window. Defined in OnlookInspector_highlight.mm (iOS);
/// Android mirror lands behind MCF8c. Caller must have already validated
/// argument shape (see `OnlookInspector::highlightNode` in
/// OnlookInspector.cpp).
facebook::jsi::Value highlightNodeImpl(
    facebook::jsi::Runtime& rt,
    int reactTag,
    std::string colorHex);

/// MC4.4 — render the current key UIWindow via `UIGraphicsImageRenderer`,
/// encode as PNG via `UIImagePNGRepresentation`, base64-encode, and return
/// as a `jsi::String`. Throws `jsi::JSError` when no key window is
/// foreground-active or the PNG encode fails. Defined in
/// OnlookInspector_screenshot.mm (iOS); Android mirror (PixelCopy-based)
/// lands behind MCF8c. Caller is `OnlookInspector::captureScreenshot` in
/// OnlookInspector.cpp — no JS-side args, so no validation is required
/// before handing off.
facebook::jsi::Value captureScreenshotImpl(facebook::jsi::Runtime& rt);

/// MC4.3 — return a plain JS `ReactNodeDescriptor` snapshot of the Fabric
/// shadow subtree rooted at `reactTag`: `{ reactTag, componentName,
/// children[] }`. Defined in OnlookInspector_walkTree.mm (iOS); Android
/// mirror lands behind MCF8c. Placeholder body until MC4.2 stabilizes the
/// fabric-handle lookup path — returns a single-level stub so editor-side
/// consumers (MC4.14-MC4.18) get a valid shape. `OnlookInspector::walkTree`
/// in OnlookInspector.cpp is the thin delegator that forwards the JSI
/// args pointer after shape validation; the impl re-checks the arg shape
/// so JSError messages stay attributable if another TU calls in directly.
facebook::jsi::Value walkTreeImpl(
    facebook::jsi::Runtime& rt,
    const facebook::jsi::Value* args,
    size_t count);

}  // namespace onlook
