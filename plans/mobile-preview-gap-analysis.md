# Mobile Preview: Gap Analysis

*What's built, what's missing, and what it takes to get from "Runtime Ready" to seeing your app on the phone.*

---

## Architecture Recap

The browser-only mobile preview has three layers:

1. **Runtime bundle** (241KB) — React 19 + reconciler + Fabric host config + WebSocket shell + eval handler. Built once, loaded by Expo Go via QR scan. Lives at `packages/mobile-preview/runtime/`.
2. **Relay server** — serves the Expo manifest + runtime bundle over HTTP, brokers WebSocket eval messages between editor and phone. Lives at `packages/mobile-preview/server/index.ts`.
3. **Editor integration** — generates the QR, transpiles user code, pushes it to the phone via WebSocket on load and on every edit. Lives in `apps/web/client/`.

Layers 1 and 2 are **complete and working**. Layer 3 is where all the gaps are.

---

## What's Complete

### Runtime (packages/mobile-preview/runtime/)

| Component | File | Status |
|-----------|------|--------|
| Scheduler polyfills (setTimeout, MessageChannel, performance.now) | `shell.js:16-94` | Done |
| Fabric bootstrap (registerEventHandler, HMRClient, RCTDeviceEventEmitter) | `shell.js:107-158` | Done |
| WebSocket connection via native WebSocketModule | `shell.js:162-192` | Done |
| Eval message handler (`{type:"eval", code:"..."}` → `(0, eval)(code)`) | `shell.js:195-213` | Done |
| RN$AppRegistry.runApplication → reconciler init → default loading screen | `shell.js:216-250` | Done |
| React 19 reconciler with custom Fabric host config | `runtime.js:1-92` | Done |
| Global exports: React, createElement, useState, useEffect, View, Text, TextC, renderApp | `runtime.js:62-90` | Done |
| Bundle build script | `server/build-runtime.ts` | Done |

### Relay Server (packages/mobile-preview/server/)

| Component | File | Status |
|-----------|------|--------|
| Expo Updates v2 manifest serving (multipart/mixed, lowercase headers) | `index.ts:49-95` | Done |
| Runtime bundle staging + SHA256 hashing on startup | `index.ts:101-143` | Done |
| HTTP relay (manifest, bundle, health, status, no-op Expo Go endpoints) | `index.ts:203-280` | Done |
| WebSocket server with broadcast | `index.ts:149-192` | Done |
| POST /push → broadcast to all connected phones | `index.ts:155-161` | Done |
| GET /status → { runtimeHash, clients, manifestUrl } | `index.ts:164-171` | Done |
| LAN IP auto-detection | `index.ts:28-38` | Done |

### Editor QR Wiring (apps/web/client/)

| Component | File | Status |
|-----------|------|--------|
| `useMobilePreviewStatus` hook — polls /status, renders QR | `hooks/use-mobile-preview-status.tsx` | Done |
| `ExpoQrButton` rewired to mobile-preview server | `bottom-bar/expo-qr-button.tsx` | Done |
| `PreviewOnDeviceButton` rewired to mobile-preview server | `top-bar/preview-on-device-button.tsx` | Done |
| `NEXT_PUBLIC_MOBILE_PREVIEW_URL` env var | `env.ts` | Done |
| QrModal component (SVG QR rendering, status states, retry) | `components/ui/qr-modal/index.tsx` | Done |

---

## What's Missing

### 1. Editor → Phone Code Push (CRITICAL)

**The gap:** The phone loads the runtime and waits for `{type:"eval", code:"renderApp(React.createElement(...))"}` messages over WebSocket. The server has `POST /push` ready to broadcast them. But nothing in the editor ever calls `/push`. The QR modal opens, the phone connects, and then... silence.

**What needs to be built:**

- **A push service** in the editor that:
  - Opens a connection to the mobile-preview server (either persistent WebSocket to `ws://server:8788` or HTTP POST to `/push` on each change)
  - Sends the initial component tree on project load (so the user sees their app immediately after scanning the QR)
  - Re-sends on every edit (so changes appear in ~20ms)

- **Integration with the editor's change detection.** The editor already knows when files change (MobX stores, CodeFileSystem writes). The push service needs to hook into that same signal and re-generate + re-push the component code.

- **A "sync active component" model.** When the user has `App.tsx` open and edits it, the push service needs to know which file is the preview entry point and re-push from that root.

**Where it plugs in:**
- `expo-qr-button.tsx` or `preview-on-device-button.tsx` — after the QR modal shows `status: ready`, start the push service
- `apps/web/client/src/components/store/editor/` — MobX store that manages the push lifecycle
- New: `apps/web/client/src/services/mobile-preview-push/` or similar

**Runtime contract (what the phone expects):**
- Message format: `{"type":"eval", "code":"<js string>"}`
- The `code` string has access to: `React`, `createElement`, `useState`, `useEffect`, `useRef`, `useMemo`, `useCallback`, `View` (= `'View'`), `Text` (= `'RCTText'`), `RawText` (= `'RCTRawText'`), `TextC` (auto-wraps string children), `renderApp(element)`
- The code must call `renderApp(element)` with a single React element tree
- No `import`/`export` — the runtime has no module resolution. All dependencies must be inlined.
- Colors are ARGB signed ints: `0xFFdc2626 | 0` (not CSS strings)
- Text must use `RCTText` + `RCTRawText` (or the `TextC` helper), not bare strings

---

### 2. JSX → createElement Transpilation in the Browser (CRITICAL)

**The gap:** User code is JSX (`<View style={...}><Text>Hello</Text></View>`). The runtime's eval handler needs raw `React.createElement(...)` calls. Something needs to transpile JSX in the browser before pushing.

**What needs to be built:**

- **In-browser JSX transpiler.** Options:
  - **SWC compiled to WASM** (`@swc/wasm-web`) — fast, production-quality, handles TypeScript + JSX. The article's "What's Next" section recommends this.
  - **Sucrase** — already used by `@onlook/browser-metro` for the iframe canvas preview (`packages/browser-metro/`). Lighter than SWC, handles JSX + TS, no WASM needed. Could be reused.
  - **Babel standalone** — heaviest option, most compatible, probably overkill.

- **Component inlining.** The transpiler needs to resolve local imports. If `App.tsx` imports `Hello` from `./components/Hello`, the push code needs both components inlined into a single eval string. This is a mini-bundler, not just a transpiler.

- **Style mapping.** React Native styles use different properties than CSS (e.g., `backgroundColor` not `background-color`, ARGB ints not hex strings for colors in raw Fabric). The transpiler or a post-processing step needs to handle this.

**Existing art to reuse:**
- `packages/browser-metro/` already does Sucrase-based JSX transpilation for the web preview iframe. The same transpile step could feed the mobile push pipeline, with a different output target (raw createElement calls instead of ESM modules).

---

### 3. WebSocket Reconnection (HIGH)

**The gap:** The phone's WebSocket connects once during bootstrap. If it drops (network hiccup, phone backgrounded, WiFi toggle), it never reconnects. The user has to kill and re-scan.

**What's broken:**
- `shell.js:141-149` — on `websocketClosed` or `websocketFailed`, the handler logs and sets `wsConnected = false` but does NOT attempt to reconnect
- `server/index.ts:149-192` — Bun WebSocket config has no `idleTimeout`, no ping interval, no keepalive configuration

**What needs to be built:**
- **Client-side reconnection** in `shell.js`: exponential backoff retry loop on close/fail (e.g., 1s → 2s → 4s → 8s → cap at 30s). Re-call `wsModule.connect(url, [], {}, 42)` on each attempt.
- **Server-side ping/keepalive**: configure Bun's `idleTimeout` or implement periodic PING frames to prevent iOS from killing idle connections (iOS aggressively closes background sockets after ~30s of inactivity).
- **Connection status indicator** in the editor UI: show whether the phone is currently connected (poll `/status` for `clients > 0`).

---

### 4. Component Code Generation Pipeline (CRITICAL)

**The gap:** Even with transpilation solved, the editor needs a pipeline to go from "user's project files" to "single eval string the phone can run."

**What needs to be built:**

1. **Entry point detection** — find the project's root component (`App.tsx`, `App.jsx`, `App.js`, or whatever `app.json`'s `main` field points to). The CodeFileSystem has the file tree; scan for the conventional entry.

2. **Dependency graph resolution** — starting from the entry point, resolve local imports (`import Hello from './components/Hello'`) by reading those files from the CodeFileSystem. Stop at package boundaries (React, react-native — these are provided by the runtime's globals).

3. **Code concatenation + wrapping** — inline all resolved local modules into a single string, replace `import` statements with references to the inlined code, and wrap the root component in `renderApp(React.createElement(RootComponent, null))`.

4. **External package mapping** — map `import { View, Text } from 'react-native'` to the runtime's globals (`globalThis.View`, `globalThis.TextC`). Same for `react` → `globalThis.React`.

**Complexity note:** This is effectively a mini-bundler. For a prototype, a simple approach would work:
- Only support single-file components (no local imports, just the entry file)
- Map `react-native` imports to runtime globals
- Transpile JSX → createElement
- Wrap in `renderApp()`

Multi-file support can come later once the single-file path proves out.

---

### 5. Cloudflare Workers Deployment (HIGH)

**The gap:** `packages/mobile-preview/server/index.ts` is a Bun-specific local server. For production, it needs to run on Cloudflare Workers + Durable Objects.

**What needs to be built:**

- **Static runtime hosting** — upload `runtime/bundle.js` to R2 (or Workers static assets). One ~241KB file, updated only when the runtime source changes. CI/CD step, not per-user.

- **CF Worker for manifest serving** — a thin Worker that constructs the Expo Updates v2 manifest pointing at the R2 runtime URL. Similar to what `cf-expo-relay` does today, but without the build-session machinery. Pure function: hash → manifest JSON.

- **Durable Object for WebSocket relay** — CF Workers can't hold persistent WebSocket connections natively; DOs can. Each preview session = one DO instance, keyed on a session ID. Editor connects one WebSocket, phone connects another, DO broadcasts messages between them.

- **POST /push → DO forwarding** — the Worker receives HTTP POST from the editor, routes to the session's DO, DO broadcasts to connected phone(s).

**What already exists:**
- `apps/cf-expo-relay/` has Worker + DO infrastructure (wrangler.jsonc, manifest builder, BuildSession DO). The BuildSession DO is designed for the old build pipeline, but the WebSocket relay pattern is similar.
- `apps/cf-expo-relay/src/manifest-builder.ts` — can be reused for constructing the manifest pointing at R2 instead of the builder's output.

**What's dead code for the new path:**
- `apps/cf-esm-builder/` — the entire Container build pipeline (Dockerfile, build.sh, run-metro.sh, run-hermes.sh) is unused in the browser-only architecture. Keep only if you want an internal tool to rebuild the runtime bundle itself.
- `apps/cf-esm-builder/src/do/build-session.ts` — the state machine (pending → building → ready → failed) is for per-user builds. The new path has no per-user builds.

---

### 6. Bi-Directional Editing: Touch → Editor (MEDIUM)

**The gap:** The article describes capturing touch events on the phone and sending them back to the editor to enable "click to select component" workflows. This is entirely unimplemented.

**What needs to be built:**

- **Event capture in the Fabric host config** — `fabric-host-config.js` currently has an empty `registerEventHandler`. It needs to intercept touch/press events and extract:
  - The React tag of the touched node
  - Screen coordinates
  - The component type and props

- **Upstream WebSocket messages** — phone → server → editor. The WebSocket is already bidirectional (`shell.js:186-189` handles `message` events). Define an upstream message format like `{type:"touch", tag: 42, x: 100, y: 200, componentType: "View"}`.

- **Editor-side handler** — the editor needs to receive these messages and map them to the component tree in the canvas. This requires:
  - A mapping from Fabric react tags to source file locations
  - Integration with the editor's element selection system (highlight the component, open its properties panel)

**Prerequisite:** the code push pipeline (gap #1) must be working first, since the phone needs to be rendering the user's actual component tree (not the placeholder) for touch events to be meaningful.

---

### 7. Android Validation (MEDIUM)

**The gap:** The runtime bundle is platform-agnostic (same `bundle.js` for iOS and Android). The server serves it correctly for both platforms. But nobody has tested it on Android Expo Go.

**What needs to be validated:**

- **Fabric API compatibility** — `nativeFabricUIManager` methods (`createNode`, `appendChild`, `completeRoot`, etc.) should be identical on Android new arch, but this is unverified.
- **WebSocket module name** — iOS uses `nativeModuleProxy.WebSocketModule`. Android might use a different proxy name or module name.
- **ARGB color format** — iOS Fabric uses signed 32-bit ARGB ints (`0xFF2d1b69 | 0`). Android should be the same, but verify.
- **HMRClient.setup arguments** — native dispatch format may differ between iOS and Android Expo Go.
- **Hermes vs JSC** — Android Expo Go uses Hermes. The runtime works on Hermes (confirmed on iOS where Expo Go also uses Hermes in bridgeless mode). Should be fine, but validate `eval()` and `new Function()` availability.

**How to test:** scan the same QR with Android Expo Go on an Android device. If the "Runtime Ready" screen appears, the bootstrap is compatible. If not, check `adb logcat` for the specific error.

---

## Priority Order

| Priority | Gap | Effort | Impact |
|----------|-----|--------|--------|
| **P0** | Editor → Phone code push | Medium | Without this, the phone shows a placeholder forever |
| **P0** | JSX transpilation in browser | Medium | Required for code push to work |
| **P0** | Component code generation pipeline | Medium-Large | Required for code push to work |
| **P1** | WebSocket reconnection | Small | Connection drops silently; user has to re-scan |
| **P1** | CF Workers deployment | Large | Required for production; local-only until done |
| **P2** | Android validation | Small | Likely works; just needs testing |
| **P3** | Bi-directional touch editing | Large | Design-time feature; not needed for basic preview |

---

## Completed (2026-04-13)

The following slice of the plan is now implemented locally:

- **Editor → Phone code push is wired.** The editor now builds an eval payload and POSTs it to the mobile-preview server's `/push` endpoint after the QR flow reaches `ready`.
- **Browser-side JSX/TS transpilation is in place.** A new editor-side mobile preview service uses Sucrase to transpile project files in the browser.
- **A minimal component code generation pipeline exists.** The implementation:
  - Detects the entry point from `package.json#main` or common Expo conventions (`App.tsx`, `index.tsx`, etc.)
  - Walks local project files from the active branch VFS
  - Resolves local imports
  - Rejects unsupported bare package imports outside the currently supported runtime shim set
  - Wraps the result in a small CommonJS-style runtime and calls `renderApp(...)`
- **Auto-push on change is wired.** Once the device preview modal is open and ready, the editor watches the active branch file system and re-pushes after relevant file changes.
- **Late phone connections now recover.** The relay server stores the latest pushed eval payload and replays it to newly connected phones so scanning after the first push no longer leaves the device on the placeholder screen.
- **WebSocket reconnection is implemented in the runtime.** The phone runtime now retries dropped WebSocket connections with exponential backoff instead of requiring a full re-scan after every disconnect.

### Files Added / Updated

- `apps/web/client/src/services/mobile-preview/index.ts`
- `apps/web/client/src/services/mobile-preview/__tests__/index.test.ts`
- `apps/web/client/src/hooks/use-mobile-preview-status.tsx`
- `apps/web/client/src/app/project/[id]/_components/top-bar/preview-on-device-button.tsx`
- `apps/web/client/src/app/project/[id]/_components/bottom-bar/expo-qr-button.tsx`
- `packages/mobile-preview/server/index.ts`
- `packages/mobile-preview/runtime/shell.js`

### What Still Needs Verification

- **End-to-end device validation on iPhone.**
  - Open an ExpoBrowser branch in the editor
  - Click `Preview on device`
  - Scan the QR in Expo Go
  - Confirm the real app renders instead of the "Runtime Ready" placeholder
  - Save edits in the editor and confirm they appear on-device without re-scanning
- **Reconnect behavior on a real device.**
  - Put the phone in the background or toggle Wi‑Fi
  - Confirm the runtime reconnects and receives the latest pushed payload
- **Supported package surface.**
  - The current implementation only shims a small runtime-safe set of bare imports:
    `react`, `react-native`, `react-native-safe-area-context`, `expo-status-bar`, `expo-router`
  - Expo projects importing other native packages may still fail and need either additional shims or a broader bundling strategy
- **Unsaved editor buffer behavior.**
  - The current auto-push is driven by file system writes/watch events, so the primary path to verify is save-driven updates
  - If "push on every keystroke" is required rather than "push on save / file write", the code editor's in-memory buffer state still needs to be integrated
- **Runtime compatibility gaps.**
  - Validate that the current RN/Expo shims are sufficient for the seeded ExpoBrowser templates and common app structures
  - Confirm style/runtime assumptions hold on real Fabric surfaces
- **Android validation remains open.**
  - None of the Android-specific checks in the section above have been completed yet

### Not Done In This Slice

- Cloudflare Worker / Durable Object production deployment
- Bi-directional touch editing from phone → editor
- Android device validation
- A broader npm/native dependency strategy beyond the current shimmed set
- Editor UI for live connection status beyond the existing `/status` polling used to open the QR flow

---

## Suggested Implementation Order

**Phase 1 — "See my app on the phone" (P0s)**

1. Single-file transpile + push: take `App.tsx`, transpile JSX with Sucrase (already in the repo), map RN imports to runtime globals, wrap in `renderApp()`, POST to `/push`. Proves the round-trip.
2. Multi-file inlining: resolve local imports, concatenate, push as one eval string.
3. Auto-push on edit: hook into CodeFileSystem write events, re-transpile + re-push on each change.

**Phase 2 — "Reliable connection" (P1)**

4. WebSocket reconnection with backoff in `shell.js`.
5. Server-side ping keepalive in Bun config.
6. Connection status indicator in the editor UI.

**Phase 3 — "Production deployment" (P1)**

7. Upload runtime bundle to R2.
8. CF Worker for manifest serving.
9. Durable Object for WebSocket relay.
10. Editor points at CF URLs instead of localhost.

**Phase 4 — "Design-time features" (P2-P3)**

11. Android validation.
12. Touch event capture + upstream messaging.
13. Editor-side element selection from phone taps.
