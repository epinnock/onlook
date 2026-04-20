# Bundle size baseline (MCI.3)

Measured overhead of the `target: 'onlook-client'` bundler mode (with `isDev:
true` → MC4.12/MC4.13 `__source` injection) relative to a vanilla `target:
'expo-go'` production bundle, for a minimal nested-JSX React component.

## Current measurements

Source: `packages/browser-metro/fixtures/minimal-app.tsx` (~15 lines,
nested JSX).

Captured: 2026-04-16T11:58:26.588Z on `feat/mobile-client` (origin
`ffe1fc93`).

Run:

```
bun run packages/browser-metro/scripts/bundle-size-audit.ts
```

JSON (schemaVersion 1):

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-04-16T11:58:26.588Z",
  "entry": "packages/browser-metro/fixtures/minimal-app.tsx",
  "expoGo": { "bytes": 4508, "human": "4.4 KB" },
  "onlookClient": { "bytes": 4456, "human": "4.4 KB" },
  "delta": { "bytes": -52, "human": "-0.1 KB", "pct": "+-1.15%" }
}
```

## Reading the numbers

| Target          | Bytes | Human  | Notes                                                           |
|-----------------|-------|--------|-----------------------------------------------------------------|
| `expo-go`       | 4508  | 4.4 KB | `isDev: false`, `jsxRuntime: 'automatic'` + `imports` transform |
| `onlook-client` | 4456  | 4.4 KB | `isDev: true`, jsx-source (classic runtime) + `imports` + `__source` metadata |
| **Delta**       | **-52**   | **-0.1 KB** | **-1.15 %**                                                     |

Observation: for this fixture, the classic-runtime + `__source` path is
slightly _smaller_ than the automatic-runtime production path. The automatic
runtime's injected `require('react/jsx-dev-runtime')` plus its wrapper
boilerplate edges out the size of the `__source` literal objects when the
component tree is small. The delta is expected to flip positive as fixtures
scale (more JSX elements → more `__source` objects → grows O(n) vs a fixed
runtime import cost).

Threshold sanity (MCI.3 validate step: `≤ 20 KB` for onlook-client):
`4.4 KB ≪ 20 KB` — well under budget.

## `hello-onlook` fixture (CI gate)

Source: `packages/browser-metro/fixtures/hello-onlook.tsx` — a single
`<Text>Hello, Onlook!</Text>` component, representing the smallest
realistic user bundle. This is the fixture the `mobile:audit:bundle-size`
npm script (and the `typecheck-and-unit` CI job) measures and gates on.

Captured: 2026-04-16 on `feat/mobile-client`.

Run:

```
cd apps/mobile-client && bun run mobile:audit:bundle-size
# or directly:
bun packages/browser-metro/scripts/bundle-size-audit.ts --fixture=hello-onlook
```

JSON (schemaVersion 1):

```json
{
  "schemaVersion": 1,
  "fixture": "hello-onlook",
  "budget": { "target": "onlook-client", "bytes": 20480, "human": "20.0 KB" },
  "expoGo": { "bytes": 4147, "human": "4.0 KB" },
  "onlookClient": { "bytes": 4047, "human": "4.0 KB" },
  "delta": { "bytes": -100, "human": "-0.1 KB", "pct": "+-2.41%" }
}
```

| Target          | Bytes | Human  |
|-----------------|-------|--------|
| `expo-go`       | 4147  | 4.0 KB |
| `onlook-client` | 4047  | 4.0 KB |
| **Budget**      | 20480 | 20.0 KB |

`4.0 KB ≪ 20 KB` — ~20 % of budget. The audit script exits 1 if
`onlookClient.bytes > 20480` for the named fixture; the CI gate runs the
`hello-onlook` fixture on every `typecheck-and-unit` job.

## How to regenerate

```
bun packages/browser-metro/scripts/bundle-size-audit.ts
bun packages/browser-metro/scripts/bundle-size-audit.ts --fixture=hello-onlook
bun packages/browser-metro/scripts/bundle-size-audit.ts path/to/other-fixture.tsx
```

stdout is the JSON report (schemaVersion 1); stderr is a one-line human
summary. Exits 1 if the `onlook-client` measurement exceeds 20480 bytes
(20 KiB) — the MCI.3 budget.
