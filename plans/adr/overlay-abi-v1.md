# ADR-0001: Overlay ABI v1

**Status:** Proposed
**Date:** 2026-04-21
**Decider(s):** two-tier-bundle worktree session; pending human ratification
**Related task(s):** [`plans/two-tier-overlay-v2-task-queue.md`](../two-tier-overlay-v2-task-queue.md) — tasks #1–5, #9–10, #14–22, #30, #53, #69, #75

## Context

The repo currently mixes four bundle/wire dialects that cannot interoperate:

- `cf-expo-relay/src/session.ts` legacy DO storing `{type:'bundle', bundle}` into KV.
- `cf-expo-relay` new `HmrSession` DO routing `POST /push/:id` + `WS /hmr/:id`.
- `mobile-client-protocol/src/ws-messages.ts` WS schema with `{type:'bundleUpdate', bundleUrl}`.
- `packages/mobile-preview/runtime/shell.js` B13 handler matching `{type:'eval', code}` and
  calling `eval(code)` directly.

The mobile-client's `AppRouter.tsx:217` notes "the OnlookRuntime.runApplication JSI binding
isn't installed in this build" and falls back to `eval(bundleSource)` + `globalThis.onlookMount`
— the Spike B shim, not the two-tier plan. `apps/mobile-client/index.js` calls
`TurboModuleRegistry.get('OnlookRuntimeInstaller').install()`, but that call only publishes
`__onlookDirectLog` and backfills `nativeLoggingHook`; it does not register `runApplication` or
`reloadBundle` as host functions. Meanwhile `OnlookRuntime_reloadBundle.cpp` validates
`(bundleSource: string)` but the live dispatcher and integration test pass a bundle URL, and the
dev-menu action (`src/actions/reloadBundle.ts`) calls `DevSettings.reload()` instead of the JSI
method.

The overlay format emitted by `browser-metro/src/host/iife-wrapper.ts` is an async IIFE that
prefetches URL imports via dynamic `import()` — a pattern Hermes does not support — and no
mechanism exists today for an overlay's `require('react')` to resolve against a Metro-built
base bundle's numeric module registry.

Without a single ABI every layer targets, further work on any one layer silently diverges from
the others. This ADR fixes the contract.

## Decision

**Define a single cross-layer contract — "Overlay ABI v1" — that every layer targets. Everything
else in the two-tier system is downstream of this contract.** Changes that follow from ratifying
this ADR:

- The base bundle installs exactly one global, `globalThis.OnlookRuntime`, with a fixed shape
  (see "Runtime globals").
- Overlays ship as a single CJS module string that calls `OnlookRuntime.require(spec)` for every
  bare import and its own local `require` for relative imports. No `import()`, no top-level ESM,
  no import-map CDN.
- The wire message the editor pushes and the mobile client mounts is named `overlayUpdate`. All
  of `eval`, `bundle`, and `bundleUpdate` are retired from the product path.
- The native JSI host object replaces `OnlookRuntime` on `globalThis` *after* the base JS
  fallback has installed itself, and preserves the same shape; tests can run against the JS
  fallback without any native build.
- Assets resolve through `OnlookRuntime.resolveAsset(assetId)`. Every overlay-referenced asset
  is a content-hashed blob registered in an `OverlayAssetManifest` that travels alongside the
  overlay source on the wire.

ABI v1 is frozen against this ADR. Breaking changes require a new ADR and a bumped `abi`
version string; editor and mobile client must both refuse overlays whose `abi` does not match.

## Bridgeless requirements

ABI v1 assumes the mobile client is built with `newArchEnabled: true` and `jsEngine: "hermes"`.
Both flags are already set in `packages/base-bundle-builder/fixtures/hello/app.json` and required
by the OnlookRuntime's JSI install path.

Implications the ABI relies on:

- **TurboModule install timing.** Bridgeless has no `RCTBridge` constructor hook, so native
  modules are lazy. The `OnlookRuntimeInstaller` TurboModule's `install()` method is explicitly
  called from `apps/mobile-client/index.js` before `registerRootComponent(App)`, which in turn
  runs before the base bundle's entry module evaluates. This gives us the installation-order
  guarantee below.
- **No JIT.** Hermes is AOT-only; eval'd overlay source runs interpreted, not compiled. See
  §"Performance envelope".
- **JSI-direct events.** Phone→relay messages (taps, console, errors, inspector selections) are
  delivered by synchronous JSI host function calls to a native WebSocket client on the JS
  thread — no `RCTDeviceEventEmitter` bridge hop. The native WS client must be ready when
  `OnlookRuntime.install()` returns (cannot be lazy-loaded).
- **Fabric-only renderer.** Mount and teardown go through `AppRegistry.runApplication` and
  `ReactFabric.render`. Direct use of private globals like `global.fabricUIManager` or
  `globalThis.fab` is forbidden at this layer — the B13 shell's reliance on those (to be
  removed in task #89) is exactly what the ABI is replacing.

## Installation order

Hard contract: **by the time the base bundle's entry module runs its first line of JS,
`globalThis.OnlookRuntime` already exists with `abi === 'v1'`.**

Implementation responsibility:

- **Native builds.** The `OnlookRuntimeInstaller` TurboModule's `install()` method installs the
  native JSI host object. `apps/mobile-client/index.js` calls `installer.install()`
  synchronously before invoking `registerRootComponent(App)`. Adding async work to this path
  is a contract violation.
- **JS-fallback builds (tests, harnesses).** The base bundle's entry module's very first
  statement checks for `globalThis.OnlookRuntime`. If absent, it installs the JS fallback
  (Phase 2 tasks #14–21) before any other side effect runs. If present with `__native === true`,
  it skips install — native has already taken over.

Overlays may assume `globalThis.OnlookRuntime.abi === 'v1'` on entry; they never need to
install it themselves, and should not try.

## Runtime globals

The base bundle installs exactly one symbol on `globalThis`. The runtime shape is the same in
both the JS fallback (used in tests and non-native harnesses — Phase 2 tasks #14–21) and the
native host object (Phase 3 tasks #23–25). Native replaces JS fallback method-for-method after
its installer runs; the base bundle must not construct a second `OnlookRuntime` once
`globalThis.OnlookRuntime.__native === true` is set.

```ts
declare global {
  interface OnlookRuntimeAPI {
    /** Literal 'v1' for this ADR. Bumped per future ABI ADR. */
    readonly abi: 'v1';
    /** Implementation tag: 'js' | 'native'. Informational only. */
    readonly impl: 'js' | 'native';
    /** True once the native host object has taken over. */
    readonly __native?: true;

    /**
     * Resolve a bare specifier against the base alias map, returning the base bundle's
     * already-initialized module exports. Throws `OnlookRuntimeError` with kind
     * 'unknown-specifier' for specifiers not in the alias map.
     *
     * Relative specifiers ('./foo', '../bar') are NOT handled here — the overlay's local
     * `require` owns those.
     */
    require(specifier: string): unknown;

    /**
     * Evaluate the overlay CJS source in a scope where its `require` call resolves bare
     * imports through `OnlookRuntime.require` and relative imports through the overlay's own
     * local module table (emitted by `wrap-overlay.ts`). Calls `renderApp` (or native
     * equivalent) with the default export and `props`.
     *
     * Subsequent calls remount: existing tree torn down, new tree mounted on the same Fabric
     * root tag. Last-mount source and props are cached (see `OnlookRuntime.lastMount`).
     *
     * `props` is **overlay-visible session metadata only** — sessionId, relay URL, user-facing
     * flags. The Fabric root tag is owned by the runtime and is never exposed in `props` nor
     * settable through this call: bridgeless Fabric assigns root tags natively, and overlay
     * code cannot legally pick one. Any `rootTag` field passed in `props` is ignored.
     */
    mountOverlay(
      source: string,
      props?: Record<string, unknown>,
      assets?: OverlayAssetManifest,
    ): void;

    /** Tear down the current tree without remounting. Safe to call before first mount. */
    unmount(): void;

    /** Resolve an assetId from the most recently mounted OverlayAssetManifest. */
    resolveAsset(assetId: string): AssetDescriptor;

    /** Force asset bytes into the local cache. Resolves once all requested assets are ready. */
    preloadAssets(assetIds: readonly string[]): Promise<void>;

    /** Register a font asset with the native font loader. */
    loadFont(
      fontFamily: string,
      assetRef: string,
      options?: { weight?: number; style?: 'normal' | 'italic' },
    ): Promise<void>;

    /** Surface a runtime error to the editor via the relay /hmr/:id channel. */
    reportError(error: OnlookRuntimeError): void;

    /** Introspection for dev-menu reload + reconnect replay. Read-only. */
    readonly lastMount?: {
      readonly source: string;
      readonly props: Record<string, unknown>;
      readonly assets?: OverlayAssetManifest;
    };
  }

  var OnlookRuntime: OnlookRuntimeAPI;
}
```

## Overlay source format

The editor produces a single UTF-8 string per overlay: an ES5-safe CJS IIFE, no top-level ESM,
no dynamic `import()`. Emitted by `wrap-overlay.ts` (Phase 4, task #30) from esbuild output:

```js
// --- Overlay v1 envelope ---
;(function (__onlookRT) {
  'use strict';
  if (!__onlookRT || __onlookRT.abi !== 'v1') {
    throw new Error('overlay: OnlookRuntime ABI mismatch, expected v1');
  }

  // Local module table. Keys are module ids assigned at bundle time; values are CJS factories.
  var __modules = {
    0: function (module, exports, require) { /* user's App.tsx transpiled */ },
    1: function (module, exports, require) { /* ./utils.ts */ },
    // ...
  };
  var __cache = Object.create(null);

  function __local(id) {
    if (__cache[id]) return __cache[id].exports;
    var m = __cache[id] = { exports: {} };
    __modules[id](m, m.exports, __require.bind(null, id));
    return m.exports;
  }

  // Per-module require: resolves relative ids via the module's declared map; resolves bare
  // specifiers via OnlookRuntime.require.
  var __map = {
    0: { './utils': 1, 'react': '__base', 'react-native': '__base' },
    1: { 'react': '__base' },
  };
  function __require(fromId, spec) {
    var entry = __map[fromId][spec];
    if (entry === undefined) {
      throw new Error('overlay: unknown import ' + JSON.stringify(spec) + ' from module ' + fromId);
    }
    if (entry === '__base') return __onlookRT.require(spec);
    return __local(entry);
  }

  // Entry is always module 0.
  var entryModule = __local(0);
  var App = entryModule.default || entryModule;
  __onlookRT.mountOverlay.__pendingEntry = App;
})(globalThis.OnlookRuntime);
```

`mountOverlay(source, props, assets)` internally `eval`s this string in the Hermes context.
After eval, it picks up `mountOverlay.__pendingEntry`, registers it via `AppRegistry`, and
commits to the cached root tag. The epilogue communicates the default export via a side
channel instead of a top-level `return`, which Hermes disallows.

Key guarantees the wrapper must maintain (enforced by Phase 4 tests #36, #37):

- No top-level `import`, `export`, `await`, or dynamic `import()`.
- No reference to globals outside `globalThis.OnlookRuntime` and ES5.1 intrinsics.
- Module 0 is always the overlay entry.
- Every bare specifier in `__map` either equals `'__base'` (resolve via `OnlookRuntime.require`)
  or a numeric module id (resolve via the overlay's own `__local`).

## Import rules

| Specifier kind | Example | Resolved via | Failure mode |
|---|---|---|---|
| Relative | `./utils`, `../hooks/useX` | overlay `__map[fromId]` → `__local(id)` | bundle-time error from editor |
| Bare, in base alias map | `react`, `react-native`, `expo-asset` | `OnlookRuntime.require` | runtime `unknown-specifier` |
| Bare, pure-JS package artifact (Phase 6) | `lodash`, `zod` | prebuilt artifact table merged into `__modules` | bundle-time error if missing |
| Bare, native-backed not in base | `react-native-reanimated` | rejected in editor preflight | editor surfaces "unsupported native module" |
| Asset path | `./icon.png`, `./font.ttf` | `OnlookRuntime.resolveAsset(assetId)` via stub module | missing asset surfaces at resolve time |
| Deep import / subpath | `lodash/fp/pick` | `exports` field resolution then artifact table | editor error if not in artifact |
| Node builtins | `fs`, `path`, `os` | **rejected** | editor error; overlays don't run in Node |

The editor's preflight (task #44, #81) classifies every import into one of these rows before
upload. Anything that would resolve to `unknown-specifier` at runtime fails bundling, not
runtime.

## Asset manifest

The `OverlayAssetManifest` travels alongside the overlay source in the same `overlayUpdate`
message. Schema (Phase 7 task #53):

```ts
interface OverlayAssetManifest {
  readonly abi: 'v1';
  readonly assets: Record<string /* assetId */, AssetDescriptor>;
}

type AssetDescriptor =
  | { kind: 'image'; hash: string; mime: string; width?: number; height?: number; scale?: number; uri: string }
  | { kind: 'font';  hash: string; mime: string; family: string; weight?: number; style?: 'normal' | 'italic'; uri: string }
  | { kind: 'svg';   hash: string; mime: 'image/svg+xml'; viewBox?: string; uri: string }
  | { kind: 'media'; hash: string; mime: string; uri: string }
  | { kind: 'json';  hash: string; value: unknown }
  | { kind: 'text';  hash: string; value: string }
  | { kind: 'binary';hash: string; mime: string; uri: string };
```

Asset IDs are stable across rebuilds: `sha256(bytes)[:16]`. The editor uploads asset bytes to
R2 once per hash (task #64) and sends only the descriptor on subsequent overlays (task #65).
`resolveAsset` returns a synchronously-usable descriptor for small inline assets (`kind: 'json'`,
`'text'`) and a URI-backed descriptor for binary assets — matching Metro's
`react-native/Libraries/Image/AssetRegistry` shape closely enough to satisfy RN libraries that
call it directly (task #67).

## Wire protocol

One WebSocket route, `WS /hmr/:sessionId` (Phase 8 tasks #69–75). Shared schemas live in
`packages/mobile-client-protocol` (Phase 0 task #4). Every message is validated with Zod on
both ends (task #75).

```ts
type WsMessage =
  // editor → relay → phone
  | { type: 'overlayUpdate'; abi: 'v1'; sessionId: string; source: string; assets: OverlayAssetManifest; meta: OverlayMeta }
  | { type: 'abiHello'; abi: 'v1'; sessionId: string; role: 'editor' | 'phone'; runtime: RuntimeCapabilities }
  // phone → relay → editor
  | { type: 'onlook:console'; sessionId: string; level: ConsoleLevel; args: string[]; timestamp: number }
  | { type: 'onlook:network'; sessionId: string; requestId: string; method: string; url: string; status?: number; durationMs?: number; phase: 'start'|'end'|'error'; timestamp: number }
  | { type: 'onlook:error';   sessionId: string; error: OnlookRuntimeError; timestamp: number }
  | { type: 'onlook:select';  sessionId: string; reactTag: number; source: SourceLocation }
  | { type: 'onlook:tap';     sessionId: string; reactTag?: number; x: number; y: number; timestamp: number };

interface OverlayMeta {
  readonly overlayHash: string;         // sha256 of source
  readonly entryModule: 0;
  readonly buildDurationMs: number;
  readonly sourceMapUrl?: string;       // hosted by R2 under same session
}

interface RuntimeCapabilities {
  readonly abi: 'v1';
  readonly baseHash: string;
  readonly rnVersion: string;
  readonly expoSdk: string;
  readonly platform: 'ios' | 'android';
  readonly aliases: readonly string[];  // list of bare specifiers the base can serve
}
```

### ABI version negotiation (task #5)

Each side sends `abiHello` immediately after the WS handshake. If an editor's `abi` mismatches
the phone's, the editor must refuse to send `overlayUpdate` and surface a user-visible "base
bundle out of date" error. The relay does not enforce this — it's end-to-end, because the relay
is version-agnostic.

## Error surface

One error shape, flowing phone → relay → editor:

```ts
interface OnlookRuntimeError {
  readonly kind:
    | 'unknown-specifier'        // OnlookRuntime.require failure
    | 'overlay-parse'            // eval threw SyntaxError
    | 'overlay-runtime'          // eval threw at runtime
    | 'overlay-react'            // React error boundary caught
    | 'asset-missing'            // resolveAsset got unknown id
    | 'asset-load-failed'        // native load error
    | 'abi-mismatch'             // overlay.abi !== OnlookRuntime.abi
    | 'unsupported-native';      // editor preflight rejected
  readonly message: string;
  readonly stack?: string;
  readonly source?: { fileName: string; lineNumber: number; columnNumber: number };
  readonly specifier?: string;   // set for 'unknown-specifier' / 'unsupported-native'
  readonly assetId?: string;     // set for 'asset-*'
}
```

## Performance envelope

Hermes has no JIT; overlay source runs interpreted. Practical limits:

- **Target overlay size:** ≤ 512 KB of source. The browser-bundler must emit a build warning
  above 512 KB and a build error above 2 MB. Larger overlays indicate dependency bundling
  gone wrong (user re-bundling something that should have been a base alias or a pure-JS
  package artifact).
- **Eval latency target:** ≤ 100 ms on a 2-year-old iPhone for a typical 50–100 KB overlay.
  Editor status UI surfaces slower mounts as a warning.
- **Memory:** each `mountOverlay` call allocates a fresh module scope but reuses the Hermes
  heap. Long-running sessions that remount many overlays rely on Hermes GC to reclaim prior
  module graphs — no manual teardown beyond `onlookUnmount`.
- **No HBC in v1.** Pre-compiling overlays to Hermes bytecode (`.hbc`) would eliminate the
  interpretation overhead but requires shipping `hermesc` with the editor bundle. Deferred to
  post-MVP; captured in the task queue's Phase 12 performance gates (#99) as the guardrail
  that forces the conversation.
- **Production note:** overlays are preview-only. Production builds of user apps ship as
  regular Metro/Hermes-compiled bundles. The ABI's interpretation ceiling is a preview UX
  concern, not a product correctness concern.

## Source maps

Each overlay build emits a standalone `source.map` JSON (v3). The editor uploads it to R2 under
`overlay-sourcemap/:sessionId/:overlayHash.map` and sets `OverlayMeta.sourceMapUrl`. The phone
does not fetch source maps; it includes raw stack frames with overlay-internal line/column in
`OnlookRuntimeError.stack`, and the editor resolves to original frames using the uploaded map
(task #86).

## Unsupported native modules

A "native-backed package" is one whose Metro resolution requires a native binary that isn't in
the base bundle's Expo/RN allowlist. Examples: `react-native-reanimated` (needs JSI worklets
compiled into the binary), `react-native-skia`, `@shopify/flash-list`.

The base manifest's `runtime.aliases` is the source of truth for what is supported. When the
editor encounters a bare specifier in overlay source that isn't in `runtime.aliases` and isn't
resolvable as a pure-JS package artifact (Phase 6 task #45), it refuses to bundle and surfaces
a `kind: 'unsupported-native'` error. Adding a new native module requires a base/binary rebuild
and ADR sign-off, not an overlay change.

## Alternatives considered

- **Option A (chosen): single `OnlookRuntime` global + CJS overlay IIFE + `overlayUpdate` WS
  message.** Hermes-safe, no per-layer dialects, trivially testable in Node/JSDOM against the
  JS fallback runtime. Native implementation drops in without changing the wire or bundle
  shapes.
- **Option B: keep `bundleUpdate(bundleUrl)` + separate HTTP fetch.** Rejected. Adds a round
  trip per edit, requires CORS/auth on R2 for phones on LAN relays, and forces duplicating the
  retry/resume logic native-side. The current `reloadBundle(url)` call-site bug in the
  integration test is a direct symptom.
- **Option C: keep the B13 shell `eval` dialect and layer two-tier on top of it.** Rejected.
  `eval` in `shell.js` runs arbitrary code with no contract about what globals must exist — the
  overlay would have to ship its own mini-runtime, duplicating `OnlookRuntime` per edit.
- **Option D: ESM overlays + browser-metro async IIFE.** Rejected. Hermes rejects top-level
  `await` and `import()`; `import-map` has no analogue on-device. The browser-metro output is
  correct for the editor iframe preview — keep it there.
- **Option E: split overlay runtime into two globals (`__onlookRequire`, `__onlookMount`).**
  Rejected. Invites the exact dialect drift we're leaving behind; one global is enforceable.

## Consequences

### Positive

- One bundle model, one wire message, one runtime shape. Contract violations become typecheck
  errors, not runtime mysteries.
- Native and JS fallback runtimes share the ABI. Integration tests can exercise every path
  before the native build is wired (Phase 2 lands before Phase 3).
- `wrap-overlay.ts` becomes a static transform that's fully unit-testable.
- Editor preflight catches unsupported imports before the overlay hits the wire — phone sees
  only loads that can succeed.
- Source maps are phone-side by reference only — no base64-inlined overhead on every edit.

### Negative

- Breaking change for anything depending on the B13 `eval` / `onlookMount` path, including
  Spike B demos. Behind a feature flag during migration (task #92), removed in cleanup (#89).
- `wrap-overlay.ts` must handle module-id assignment and relative-vs-bare classification
  itself. Not free.
- Native implementation of `OnlookRuntime` (Phase 3) must match the JS fallback's semantics
  exactly — drift here recreates the dialect problem.

### Neutral

- `packages/base-bundle-builder/src/alias-emitter.ts` already produces
  `{aliases: {spec: moduleId}, specifiers}` — directly usable as the base alias map (task #9).
- `packages/mobile-client-protocol/src/overlay.ts` already has an `overlay` message with
  `{code, sourceMap?}`. Renamed and extended to `overlayUpdate` per wire protocol above.
- `apps/cf-expo-relay`'s existing `WS /hmr/:id` + `POST /push/:id` routes stay; only the
  message shape changes.

## Open questions

- Asset upload backpressure: should `overlayUpdate` block on asset upload completion, or send
  the overlay with a "pending assets" flag and let the phone retry `resolveAsset`? Default for
  v1: editor waits for all asset uploads to complete, then sends one `overlayUpdate`. Deferred
  to Phase 7 if that proves too slow.
- Multi-session: one phone per session in v1. Fan-out to many phones from one editor is a
  future extension — relay already supports it by socket count, but the last-overlay replay
  needs to be robust across concurrent joiners (task #74).
- SourceMap availability: if R2 upload fails, editor displays raw frames without mapping.
  Acceptable for v1.

## Integration recipe — wiring a new editor caller

The canonical composition for an editor-side two-tier-v1 consumer. Every new
integration should follow this shape; deviations are likely bugs.

```ts
import {
    createOverlayPipeline,
    subscribeRelayEvents,
    createReconnectReplayer,
    startEditorAbiHandshake,
    formatPreflightSummary,
    evaluatePushTelemetry,
} from '@/services/expo-relay';
import { preflightAbiV1Imports } from '@onlook/browser-bundler';
import { buildRuntimeCapabilities } from '@onlook/base-bundle-builder';

// 1. Build the composition once per editor session.
const relayUrl = env.NEXT_PUBLIC_CF_EXPO_RELAY_URL!;
const sessionId = generateSessionId();
const latest = { code: null as string | null, buildDurationMs: 0 };

const pipeline = createOverlayPipeline({
    relayBaseUrl: relayUrl,
    sessionId,
});

const ws = new WebSocket(`${relayUrl.replace('http', 'ws')}/hmr/${sessionId}`);

const replayer = createReconnectReplayer({
    relayBaseUrl: relayUrl,
    sessionId,
    latest, // read by reference — the pipeline mutates it
});

const handshake = startEditorAbiHandshake({
    ws,
    sessionId,
    capabilities: buildRuntimeCapabilities({
        baseHash: currentBase.baseHash,
        rnVersion: currentBase.rnVersion,
        expoSdk: currentBase.expoSdk,
        platform: 'ios',
    }),
    onPhoneHello: (phone) => replayer.onAbiHello(phone),
});

subscribeRelayEvents({
    ws,
    handlers: {
        onConsole: (m) => editorConsole.append(m),
        onError: (m) => editorErrorPanel.push(m),
        onTap: (m) => inspector.jumpToSource(m),
    },
});

// 2. On every file-save event in the editor, produce an overlay.
async function onFileSave(files: VirtualFsFileMap) {
    const preflight = preflightAbiV1Imports({
        files,
        baseAliases: currentBase.aliases,
        disallowed: ['react-native-reanimated', '@shopify/react-native-skia'],
    });
    if (preflight.length > 0) {
        editorStatus.show(formatPreflightSummary(preflight));
        return;
    }

    const { code, sourceMap, buildDurationMs } = await buildOverlay(files);
    latest.code = code;
    latest.buildDurationMs = buildDurationMs;

    pipeline.schedule({ overlay: { code, sourceMap, buildDurationMs } });
}

// 3. When the phone acknowledges the mount (via onlook:error absence or an
//    explicit ack message — integration's choice), flip the pipeline state.
function onPhoneAck(overlayHash: string) {
    pipeline.markMounted(overlayHash);
}
```

`pipeline.status` subscribes MobX-friendly — bind it to the editor's
status-bar UI. `evaluatePushTelemetry` is wired into `pushOverlayV1`'s
`onTelemetry` sink inside the pipeline composer.

## References

- `plans/two-tier-overlay-v2-task-queue.md` — the 100-task queue anchored on this ABI.
- `plans/two-tier-pipeline-README.md` — contributor guide (to be updated to reflect v1 once
  this ADR is ratified).
- `packages/base-bundle-builder/src/alias-emitter.ts` — existing alias-map emitter; reused for
  the base alias map.
- `packages/mobile-client-protocol/src/overlay.ts` — existing overlay schema; to be renamed to
  `overlayUpdate` per wire protocol.
- `apps/mobile-client/cpp/OnlookRuntime_reloadBundle.cpp` — existing native signature
  `(bundleSource: string)`; becomes the Phase 3 `mountOverlay` call.
- Hermes limitations: no top-level `import`, no `import()`, no top-level `await`.
