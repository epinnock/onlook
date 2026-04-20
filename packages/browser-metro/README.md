# @onlook/browser-metro

In-browser Metro-compatible bundler for the ExpoBrowser preview pipeline
(Wave C of `plans/expo-browser-implementation.md`).

The package walks a `Vfs` (any object shaped like `@onlook/file-system`'s
`CodeFileSystem`), transpiles each file with Sucrase, rewrites bare imports
to an ESM CDN, and emits a self-contained IIFE plus importmap that the
preview iframe or the Onlook native mobile client can load directly.

## Install

This is a private workspace package — consume it via the monorepo:

```ts
import { BrowserMetro } from '@onlook/browser-metro';
import type { BundleTarget } from '@onlook/browser-metro';
```

## `target` flag — preview surface selector

Every bundle is produced for exactly one of two surfaces, selected via the
`target` option on the `BrowserMetro` constructor:

```ts
export type BundleTarget = 'expo-go' | 'onlook-client';
```

Default: `'expo-go'`.

### `target: 'expo-go'`

The standard Expo Go preview path. The bundler uses Sucrase's **automatic**
JSX runtime (`jsxRuntime: 'automatic'`), does **not** inject any
`__source` metadata, and is production-oriented. Pick this when the bundle
will be consumed by a stock Expo Go client or by any surface that does not
run the Onlook inspector.

### `target: 'onlook-client'`

The Onlook-native mobile client path. When combined with `isDev: true`,
the bundler swaps Sucrase over to the **classic** JSX runtime and runs
the `transformWithJsxSource` pass (MC4.12) so every generated
`React.createElement` call carries `__source: { fileName, lineNumber }`
metadata. The mobile inspector uses that metadata to map tapped UI
elements back to their source locations in the editor.

`target: 'onlook-client'` is **dev-oriented**: when `isDev` is `false` the
`__source` injection is skipped even for this target, because the
inspector only runs in dev builds.

### When to use each

| Use case                                                   | `target`         | `isDev` |
| ---------------------------------------------------------- | ---------------- | ------- |
| Expo Go QR preview                                         | `'expo-go'`      | `true`  |
| Expo Go production bundle                                  | `'expo-go'`      | `false` |
| Onlook native client with element-to-source inspector      | `'onlook-client'`| `true`  |
| Onlook native client, production snapshot (no inspector)   | `'onlook-client'`| `false` |

### Example

```ts
import { BrowserMetro } from '@onlook/browser-metro';

const metro = new BrowserMetro({
    vfs: codeFileSystem,
    esmUrl: 'https://esm.sh',
    target: 'onlook-client',
    isDev: true,
});

const { iife, importmap, entry } = await metro.bundle();
```

The returned `iife` string is ready to be dropped into a `<script>` tag
inside the preview iframe; `importmap` populates the shell's importmap so
bare package names resolve against the configured ESM CDN.

## Public API

Re-exported from the package root (`@onlook/browser-metro`):

- `BrowserMetro` — main class.
- `BundleTarget` — `'expo-go' | 'onlook-client'`.
- `BrowserMetroOptions` — constructor options (`vfs`, `esmUrl`, `target`,
  `isDev`, `broadcastChannel`, `logger`).
- `BundleResult`, `BundleError`, `Vfs` — bundle output types and the
  `Vfs` shape the bundler consumes.

## Related tasks

- MC4.12 — Sucrase `jsx-source` transform (the `__source` injector).
- MC4.13 — Pipeline wiring: `target === 'onlook-client' && isDev` routes
  through the jsx-source transform.
- MC6.3 — Formalizes `target` as the canonical public API of browser-metro
  (this document).
