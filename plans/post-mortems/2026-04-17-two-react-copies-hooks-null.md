# Post-mortem — Two React copies dispatcher split caused "useState of null" for eval-pushed components

**Date:** 2026-04-17
**Affected:** All eval-pushed React function components that used hooks (`useState`, `useEffect`, `useRef`, etc.) on Expo Go SDK 54 via the mobile-preview runtime.
**Visibility:** User-facing — multiple prior chat sessions recorded this as "Cannot read properties of null (reading 'useState')" when Onlook's AI built RN screens using hooks (e.g. `BuyUSDC`, `PrivacyScreen`, `LoginScreen`). Workaround that had been adopted: rewrite as class components.
**Fix:** Commit `86a9d18b` on `feat/mobile-preview-merge` (PR #12).

## Symptom

A user component like:

```jsx
function Counter() {
  const [count, setCount] = useState(0);
  useEffect(() => { /* ... */ }, []);
  return <View>…</View>;
}
```

rendered by `globalThis.renderApp(React.createElement(Counter, null))` in the Expo Go runtime threw:

```
uncaught: Cannot read property 'useState' of null
```

The error fired inside React's `resolveDispatcher()`:

```js
function resolveDispatcher() {
  const dispatcher = ReactSharedInternals.H;   // ← null here
  return dispatcher;
}
function useState(s) {
  return resolveDispatcher().useState(s);       // ← null.useState throws
}
```

## Why it happened

`packages/mobile-preview/package.json` pinned `react: 19.1.0`. The root workspace (and `apps/web/client`) used `react: 19.2.0`. Bun's workspace hoisting placed 19.2.0 at `node_modules/react` and kept a local 19.1.0 at `packages/mobile-preview/node_modules/react`.

`react-reconciler@0.32.0` declares `peerDependencies: { "react": "^19.1.0" }` and its internal `require('react')` resolves relative to its own install path — `node_modules/react-reconciler/` → up → `node_modules/react` (the hoisted 19.2.0).

Meanwhile `packages/mobile-preview/runtime/runtime.js` does `const React = require('react')` which resolves from its package — to `packages/mobile-preview/node_modules/react` (19.1.0).

When `Bun.build` bundled `runtime.js`, it followed these two distinct resolution paths and emitted **two** CommonJS module wrappers into `bundle.js`:

- `require_react_development` (copy #1, 19.1.0) — comment: `packages/mobile-preview/node_modules/react/cjs/react.development.js`. Exports `useState` / `useEffect` / hooks that all read from copy #1's module-scope `ReactSharedInternals`.
- `require_react_development2` (copy #2, 19.2.0) — comment: `node_modules/react/cjs/react.development.js`. Required transitively by `require_react_reconciler_development`. Hooks here read from copy #2's module-scope `ReactSharedInternals`.

Each React copy closed over its own `ReactSharedInternals` object, each with its own `.H` slot. During reconciliation, `react-reconciler` pushes the current mount/update dispatcher onto **copy #2's** `ReactSharedInternals.H`. User code's `useState` call goes through **copy #1's** exported `useState`, which reads **copy #1's** `ReactSharedInternals.H` — never written to — and sees `null`. Call `null.useState` → TypeError.

Two prior patches masked but didn't solve this:

- `runtime.js` has `if (!React[internalsKey] && React.default && React.default[internalsKey]) React[internalsKey] = React.default[internalsKey]` — which only handled an ESM-default wrap, not a full second React instance.
- `wrap-eval-bundle.ts` builds `__reactModule = Object.assign({}, React, { useState: React.useState || globalThis.useState, … })` — but `React.useState` IS already the broken useState from copy #1; aliasing it didn't help.

## Timeline (this session)

1. Direct `/push` with a HookTest component → `uncaught: Cannot read property 'useState' of null`.
2. Same with the wrap-eval-bundle shape → same error. Ruled out the shim.
3. Probed internals via eval: `topInt.H=object` outside render. So H *is* being set somewhere; read path sees it null.
4. Grep'd `bundle.js` for `__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE` → **4 hits**, two of them `exports2.__CLIENT_INTERNALS = ReactSharedInternals` (lines 1752 and 15804). Two React modules.
5. Grep'd `exports2.version` → `"19.1.0"` and `"19.2.0"`. Confirmed the version split matched the two copies.
6. Traced the workspace: `packages/mobile-preview` pinned 19.1.0, root was 19.2.0.
7. Bumped `packages/mobile-preview/package.json` react to 19.2.0. `bun install` reported "no changes" but the stale local files at `packages/mobile-preview/node_modules/react/cjs/*.js` still had 19.1.0 code. `rm -rf packages/mobile-preview/node_modules/react && bun install --force` finally hoisted it out.
8. Rebuilt the runtime bundle: now **one** `exports2.version = "19.2.0"` in the output, bundle size dropped ~38 KB (~1093 → ~1054 KB).
9. Pushed the HookTest component again: `HOOKS: effect count=6 → 7 → 8 → 9`, setState-triggered re-renders landed, `HOST completeRoot DONE` for each commit. Screen rendered `count=N renders=N` exactly as expected.

## What to watch for

- **New workspace packages that pin `react` at a different version.** If someone adds a new `packages/foo` with `react: 19.x.y` and `19.x.y ≠` the root version, the same split can re-emerge. Guard: a lint rule (or a CI script) that asserts every workspace `package.json` declares a `react` range compatible with the root. An even stricter guard: forbid any workspace from declaring `react` at all — let the peer/hoist resolve it from the root.
- **Bun install with cached but mismatched local `node_modules/react`.** When flipping the version pin, `bun install` can silently leave the old CJS files in place. Always `rm -rf` the suspect workspace's `node_modules/<pkg>` and re-run `bun install --force` if the bundle still shows the wrong version.
- **react-reconciler major bumps.** 0.32.0 targets React 19.1+. If we upgrade reconciler in lockstep with a root-react bump we need to re-check that the peer range still lines up with the hoisted version.

## Recommended guardrail (follow-up)

Add a small build-time assert in `packages/mobile-preview/server/build-runtime.ts`:

```ts
const versionHits = rawBundle.match(/exports2?\.version = "\d+\.\d+\.\d+";/g) ?? [];
if (versionHits.length > 1) {
  console.error('[build-runtime] Multiple React copies detected in bundle:', versionHits);
  process.exit(1);
}
```

Catches the split at bundle time instead of letting it manifest as a runtime hook failure on the sim.

## Lesson

"Module X imports are deduped because they resolve to the same package name" is only true when **every path up from every consumer lands on the same physical directory**. Workspace hoisting can invisibly diverge that — always grep the bundle for module-level side effects (like `ReactSharedInternals` exports) when chasing cross-boundary hook failures.
