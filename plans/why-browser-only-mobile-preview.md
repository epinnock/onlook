# Why Onlook's Mobile Preview Isn't Just "Normal Expo"

*A plain-English explainer of why the browser-only architecture exists, why we can't use Metro, and what the shim layer is for.*

*Reference: `plans/article-native-preview-from-browser.md` (the full technical writeup by the Onlook team that describes how the browser-only preview was built).*

---

## How normal Expo development works

When a developer runs `npx expo start` in a terminal:

1. **Metro bundler** spins up as a long-running Node.js process on their laptop.
2. Metro watches the project files.
3. On every save, Metro:
   - Reads the changed files
   - Transpiles TS/JSX → JS
   - Resolves all `import` statements by walking `node_modules` on disk
   - Bundles the whole thing (user code + React + React Native + all npm packages) into a single giant JS file
   - If Hermes is configured, compiles that JS to Hermes bytecode
4. Metro serves the bundle over HTTP + a manifest endpoint.
5. Expo Go scans the QR code, fetches the manifest, fetches the bundle, evaluates it.

That's the pipeline: **Metro (Node.js) → HTTP → Expo Go**.

---

## Why that doesn't work for Onlook

Onlook is a **browser-based** editor. There's no terminal. There's no laptop running a Node process. The user opens `onlook.com`, edits code in a browser tab, and expects it to show up on their phone.

The normal Expo flow has hard dependencies that don't exist in a browser:

| Normal Expo needs | In a browser we have |
|---|---|
| Metro = Node.js process | ❌ No Node. Browser can only run JS in the browser's JS engine. |
| `node_modules/` on disk with hundreds of MB | ❌ No file system access. No disk. |
| `npm install` | ❌ Can't execute shell commands from a browser tab. |
| File watching via `fs.watch` | ❌ No fs API. |
| Long-running process per user | ❌ Browser tabs can't host persistent server processes. |
| Hermes compiler binary | ❌ Can't run native binaries in a browser. |

Every piece of Metro's infrastructure assumes it's running as a local tool on a developer machine.

---

## Option we tried: run Metro on the server

The (now-deprecated) `cf-esm-builder` path in the repo did this. When a user clicked "Preview", their source tar was uploaded to a Cloudflare container running Metro; Metro bundled inside the container and served the result to Expo Go.

Problems:

1. **Slow.** Metro does `npm install` inside the container, walks `node_modules`, bundles, runs Hermes. ~90 seconds cold, every click.
2. **Expensive.** Every user click spins up a new container. Each one costs real compute. For a free-tier editor with lots of users, it's financially nonviable.
3. **Wrong granularity.** Metro rebuilds the whole bundle even if the user only changed one line. It was never designed for live "push every keystroke" editing — it was designed for "rebuild on save during local dev."
4. **Cold-start latency.** Even with caching, the container takes seconds to boot. Not milliseconds.
5. **Breaks the hot loop.** The whole point of a visual editor is sub-100ms feedback. Metro-per-click can't deliver that.

---

## The insight that unlocks a better architecture

From `plans/article-native-preview-from-browser.md`: **you don't actually need Metro to ship a running app to Expo Go.** Expo Go just evaluates JavaScript. As long as you give it JavaScript in a format it can eval, it'll run.

So the browser-only architecture is:

1. **Bundle the React runtime once, ahead of time.** Not per user — just one time, by the Onlook maintainers. That's the 241KB runtime artifact (`packages/mobile-preview/runtime/bundle.js`). It has React 19, the reconciler, a Fabric host config, and basic shims. It's a static file.
2. **Scan the QR once.** Phone downloads the runtime. Done. No more Metro involvement.
3. **On every edit, push just the user's component code over WebSocket.** ~10KB. Not the whole bundle — just their `App.tsx` + any local components. The runtime already has React and RN primitives loaded. The phone evals the new component code on top of the running runtime.

The key split: **runtime is static and huge; user code is dynamic and tiny**. Normal Metro doesn't make this split — it rebuilds everything every time. Our architecture does.

---

## Where the shim fits in

Metro does a lot under the hood. One of its jobs is: when your code says `import { View } from 'react-native'`, Metro walks `node_modules/react-native/` and inlines all that library code into your bundle. By the time your code runs on the phone, React Native is already part of the bundle.

We skip that. The runtime has a **minimal** Fabric renderer, not the full React Native library. So when your code says `import { View } from 'react-native'`, there's no `react-native` package in the bundle — we have to fake one. **That's the shim.**

A shim is a piece of fake code that pretends to be a missing piece so the real code around it doesn't break. Think of a power adapter: your US laptop charger can't fit into a UK wall socket. The adapter doesn't change your charger or the wall — it just sits in between, plugging into one side and exposing the shape the other side expects.

In our case, the shim is **JavaScript that pretends to be React Native**.

When the user's code does `import { ScrollView } from 'react-native'`, our shim hands it a fake ScrollView that *looks* like the real one from its perspective — same name, same props, same shape — but internally it just renders as a primitive the runtime actually knows how to draw (a raw Fabric `View`).

The shim lives in `apps/web/client/src/services/mobile-preview/index.ts`, inside the `wrapEvalBundle` function, and is injected into every bundle we push to the phone.

---

## `react-native-web` vs. our shim

A natural question: "Expo has `react-native-web` — can't we just use that?"

No, because `react-native-web` renders to **the DOM** (`<div>`, CSS). Our phone target isn't a browser — it's Fabric, React Native's native iOS/Android view system. There's no DOM on the phone.

Two separate rendering paths, two separate compatibility layers:

| Path | Where it runs | What bridges the code |
|---|---|---|
| **Canvas iframe** (inside the editor) | Browser | `react-native-web` → DOM |
| **Mobile preview** (physical phone via Expo Go) | iOS/Android native runtime | **Our shim** → Fabric |

Same source code, two different translators because the targets are fundamentally different environments.

We do, however, reuse Expo's JS-side wrappers for native packages (e.g., `expo-camera`, `expo-location`). Those packages' JS code is platform-agnostic — they just call `NativeModules.ExponentXxx`. Expo Go has those native modules compiled in. We copy Expo's existing JS wrappers into our shim registry, and they find the native modules automatically.

---

## The tradeoff summary

| | Normal Expo | Onlook browser-only |
|---|---|---|
| Where it runs | Developer's laptop | Browser tab |
| What runs the build | Metro (Node.js) | In-browser transpile (Sucrase) + static shim |
| Edit → device latency | 1–30 seconds (depends on Metro cache) | ~20ms |
| Per-user infrastructure | None (local machine) | None (static runtime + thin relay) |
| Works without install | ❌ Requires Node + npm | ✅ Just open a URL |
| Handles arbitrary npm packages | ✅ Metro resolves everything | ❌ Only pre-shimmed packages |

The shim is the **price of admission** for having no laptop, no Node, no build step. We trade "works with anything on npm" for "works in a browser with instant edits and no install."

The shim expansion plan (`plans/mobile-preview-shim-implementation.md`) is how we claw back that flexibility: over time, we support more and more packages until the browser-only path covers the same surface Metro does for typical apps.

---

## In one sentence

Normal Expo needs a developer's laptop running Metro; Onlook runs in a browser tab where none of that exists, so we replaced Metro's "bundle everything from node_modules per edit" with "ship a static runtime once, push tiny code deltas over WebSocket" — and the shim is what stands in for the `node_modules` library code that Metro would've inlined.

---

## Related docs

- `plans/article-native-preview-from-browser.md` — full technical writeup by the Onlook team, including how the Expo Go runtime was reverse-engineered, the Fabric bootstrap sequence, and the 241KB runtime bundle architecture.
- `plans/mobile-preview-gap-analysis.md` — what's built vs. what's missing in the current mobile preview implementation.
- `plans/mobile-preview-shim-implementation.md` — detailed plan + timeframes for expanding shim coverage to typical Expo apps.
