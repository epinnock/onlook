# Spike B Result: Bridgeless Fabric Mount via Expo Go

**Date:** 2026-04-09
**Status:** PROVEN — custom JS bundles can mount native views on iOS via Expo Go + Cloudflare Workers without React/Metro/Expo CLI

## Summary

Proved end-to-end: custom JS bundle → CF Workers preview server → Expo Go (SDK 54) on physical iPhone → native view mounted via Fabric in ~3ms.

Built a multi-node login screen (15+ native nodes with text, styled containers, and layout) and demonstrated interactive state changes via touch events, all without React or any standard RN modules — just raw `nativeFabricUIManager` Fabric primitives.

## The Bridgeless + New-Arch Surface Mount Path

The discovery process (B1→B9) determined the exact bootstrap sequence Expo Go SDK 54 uses in bridgeless + new-arch mode:

1. **JS bundle loads** — `__d()` registers modules, `__r(0)` runs the entry point
2. **Native dispatches `HMRClient.setup`** via `RN$registerCallableModule` callable-module path (positional 6-arg signature: `platform, bundleEntry, host, port, isEnabled, scheme`)
3. **Native reads `global.RN$AppRegistry` directly via JSI** — NOT via the callable-module dispatcher, NOT `global.AppRegistry`
4. **Native calls `RN$AppRegistry.runApplication("main", { rootTag, initialProps })`** — standard AppRegistry signature, just accessed via a different global name
5. **Inside `runApplication`, JS builds the Fabric tree synchronously** and calls `completeRoot` to commit

### Key Discoveries

| Discovery | Detail |
|-----------|--------|
| `RN$AppRegistry` (not `AppRegistry`) | Native reads `global.RN$AppRegistry` via direct JSI property lookup, not via the callable-module dispatcher |
| `registerEventHandler` required | Must call `nativeFabricUIManager.registerEventHandler(fn)` before mount or C++ crashes with "non-std C++ exception" |
| `RCTDeviceEventEmitter` needed | Must register via `RN$registerCallableModule` — native emits errors/events through it |
| Props are top-level | Color as ARGB signed int (`0xffff0000 \| 0`), layout props direct (not wrapped in `style`) |
| Text via `RCTText` + `RCTRawText` | Standard Fabric text path works — `RCTText` container with `RCTRawText` child containing `{ text: "..." }` |
| Read-only globals | `RN$handleException` and `RN$notifyOfFatalException` are preinstalled by Hermes runtime as non-configurable, non-writable |

## Minimum Viable Bundle

Required runtime setup (in execution order):

```js
// 1. Fabric event handler — MUST be first or C++ crashes
nativeFabricUIManager.registerEventHandler(function() {});

// 2. HMRClient — native dispatches setup immediately after bundle load
RN$registerCallableModule('HMRClient', () => ({
  setup(platform, bundleEntry, host, port, isEnabled, scheme) {},
  enable() {}, disable() {}, registerBundle() {}, log() {},
}));

// 3. Event emitters — error pipeline needs these
RN$registerCallableModule('RCTDeviceEventEmitter', () => ({
  emit() {}, addListener() {}, removeListener() {}, removeAllListeners() {},
}));

// 4. AppRegistry — the mount entry point
global.RN$AppRegistry = {
  runApplication(appKey, { rootTag, initialProps }) {
    // Build tree via nativeFabricUIManager.createNode/completeRoot
  },
};
```

## Fabric Tree-Mutation API

Available on `nativeFabricUIManager`:

```
createNode(reactTag, viewName, rootTag, props, instanceHandle) → node
createChildSet(rootTag) → childSet
appendChildToSet(childSet, node)
appendChild(parentNode, childNode)
completeRoot(rootTag, childSet)
cloneNodeWithNewProps(node, newProps) → node
cloneNodeWithNewChildren(node) → node
cloneNodeWithNewChildrenAndProps(node, newProps) → node
dispatchCommand(node, command, args)
```

NOT available in this SDK: `cloneNode`, `startSurface`, `stopSurface`, `getPublicInstance`

## Performance

- Module init to surface mount: **~3ms** on iPhone 14 Pro
- Bundle size (minimum viable): **~80 KB** (including metro-compatible preamble)
- No React, no reconciler, no polyfills needed for static views

## Open Questions for Next Steps

1. **Hot reload without QR rescan** — Expo Go calls `HMRClient.setup` with `isEnabled=true` and expects a WebSocket at `ws://host:port`. Need WebSocket upgrade in CF Worker or local proxy.
2. **React reconciler integration** — For dynamic UIs, need the React Fabric renderer. Can either bundle a minimal React or build a lightweight custom reconciler on top of the Fabric primitives.
3. **Text input** — Need to handle `RCTTextInput` component + focus/blur events for real form fields.
4. **ScrollView** — For longer UIs, need `RCTScrollView` + scroll event handling.
5. **Navigation** — Multiple screens would need either a JS-side navigator or multiple surfaces.

## Files

All spike bundles are in `/tmp/spike-bundle/` (not committed):
- `preamble.js` — Metro-compatible `__d()/__r()` module system
- `test-module-b9.js` — Minimum viable Fabric mount (red square)
- `test-module-b10.js` — Multi-node login screen
- `test-module-b10b.js` — Login screen v2 + touch interactivity

## Log Capture Setup

```bash
# Install
brew install libimobiledevice

# Grab logarchive from connected iPhone
idevicesyslog archive --age-limit 300 /tmp/expo.tar

# Extract and query
mkdir -p /tmp/expo.logarchive
tar -xf /tmp/expo.tar -C /tmp/expo.logarchive
log show /tmp/expo.logarchive \
  --predicate 'process == "Expo Go" AND eventMessage CONTAINS "SPIKE_B"' \
  --info --debug --last 5m
```

Note: `idevicesyslog` live streaming shows `<private>` for JS log messages due to iOS unified logging privacy. Use the logarchive extraction method above for unredacted logs.
