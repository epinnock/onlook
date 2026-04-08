# Expo browser bundle artifact — Hermes-compatible R2 layout

**Owner task:** `TH0.3` (Wave H0 of `plans/expo-browser-e2e-task-queue.md`).
**Consumed by:** `TH1.2` (Container build script — writer), `TH2.3`
(`cf-esm-builder` `GET /bundle/:hash` — reader), `TH3.1` (`cf-esm-cache`
proxy/cache), `TQ1.1` (`cf-expo-relay` manifest builder), scenarios 09/10/12.
**Source plan:** `plans/expo-browser-implementation.md`, and the sibling
protocol spec `plans/expo-browser-builder-protocol.md` (TH0.2).

This file locks the **exact bytes** that live in R2 after a successful Phase H
build, and what `GET /bundle/:hash` must return. Every downstream task reads
key shapes, file names, and headers from here — there is one source of truth.

---

## Why Hermes (not a JS string)

Expo Go on iOS and Android ships with the **Hermes** JavaScript engine as the
default runtime (SDK 54 makes Hermes mandatory for Expo Go — see
`expo-browser-fixture-spec.md`). Hermes does **not** eval a source-JS string in
release mode; it memory-maps a **bytecode** file and executes it directly.

The Metro bundler alone only produces the source-JS bundle (`index.js` /
`index.android.bundle` as UTF-8 text). To get a file Expo Go can actually
launch, Phase H must then run the Hermes compiler (`hermesc` / `hermes
-emit-binary`) over Metro's output to produce a real Hermes bytecode file. The
artifact we persist in R2 is that bytecode file — **not** the intermediate JS
string.

A Hermes bytecode file starts with the four magic bytes `0xc6 0x1f 0xbc 0x03`.
This is the canonical "is this a Hermes bundle" test and is asserted in
scenario 12 (TH5.3).

---

## R2 layout

- **Bucket:** `expo-bundles` (shared binding name between `cf-esm-builder`
  writes and `cf-esm-cache` reads/writes; the `esm-packages` bucket from
  `cf-esm-cache`'s prior life stays separate and is not reused).
- **Prefix per build:** `bundle/${bundleHash}/` where `bundleHash` is the
  deterministic content hash described in `plans/expo-browser-builder-protocol.md`
  (SHA-256 of the source-tar, lower-hex, no prefix).
- **Keys inside the prefix** (writer order — `meta.json` last, so readers can
  use it as a completion sentinel):

```
expo-bundles/
└── bundle/${bundleHash}/
    ├── index.android.bundle    ← Hermes bytecode (binary, magic 0xc6 0x1f 0xbc 0x03)
    ├── assetmap.json           ← { assets: [...] }, may be empty for fixture
    ├── sourcemap.json          ← Metro source-map, optional but always written when available
    ├── manifest-fields.json    ← Internal JSON the relay folds into the Expo manifest
    └── meta.json               ← Build metadata; written LAST (sentinel for readers)
```

## File-by-file contract

### `index.android.bundle`

- **MIME:** `application/javascript` on the wire (Expo Go expects this header
  even though the body is bytecode). The R2 object is stored raw with
  `httpMetadata.contentType = 'application/javascript'`.
- **Magic header:** first four bytes MUST be `0xc6 0x1f 0xbc 0x03`. The
  `cf-esm-builder` writer (TH1.2) refuses to `put()` a file whose first four
  bytes do not match — a defensive guard against the case where Hermes wasn't
  run after Metro and we'd otherwise ship an unrunnable JS string.
- **Naming:** always `index.android.bundle` even though the file is engine
  bytecode and platform-neutral at the Hermes layer. This is the filename
  Expo Go's updater asks for by convention.

### `assetmap.json`

```json
{
  "assets": [
    {
      "httpServerLocation": "/assets/components",
      "name": "logo",
      "type": "png",
      "hash": "4f2e...cafebabe"
    }
  ]
}
```

- Emitted by Metro via `--asset-output`.
- An empty `{ "assets": [] }` is valid and is what the R0 fixture produces
  (no PNGs — see `expo-browser-fixture-spec.md`).

### `sourcemap.json`

- Metro's raw source-map output (v3). Optional but **always** written when
  Metro produces one — we never drop it, even in production, because scenario
  12's failure mode is far easier to diagnose with a map.

### `manifest-fields.json`

```json
{
  "runtimeVersion": "exposdk:54.0.0",
  "launchAsset": { "key": "bundle", "contentType": "application/javascript" },
  "assets": [],
  "metadata": { "branch": null }
}
```

- Internal JSON used by `cf-expo-relay`'s manifest builder (TQ1.1). It is
  **not** the Expo manifest itself — the manifest is built per-request by
  `cf-expo-relay` so the `launchAsset.url` and any asset URLs can be rewritten
  to the right public base URL (`cf-esm-cache` host) for the environment
  serving the QR code.
- Fields left undefined here (e.g., `createdAt`, `id`) are filled in by the
  relay at request time.

### `meta.json`

```json
{
  "sourceHash": "sha256 of the input source tar",
  "bundleHash": "same as the R2 prefix",
  "builtAt": "2026-04-07T12:34:56.000Z",
  "expoSdkVersion": "54.0.0",
  "hermesVersion": "0.12.0",
  "sizeBytes": 1234567,
  "fileCount": 5
}
```

- Surfaced by `GET /build/:id` and the dashboard.
- Written **last** by the Container build script — readers treat presence of
  `meta.json` as the "build is complete, safe to serve" sentinel to avoid
  races against in-progress writes.

---

## Determinism guarantees

Same source-tar in → byte-for-byte identical `index.android.bundle` out.
This is required by TH4.5 (cache-hit tests) and by the `bundleHash === sourceHash`
invariant the editor relies on to skip redundant builds.

Achieved by:

- **Pinned Expo SDK + RN versions** in the Container image (SDK 54 / RN 0.81
  — see `expo-browser-fixture-spec.md`).
- **Pinned Hermes binary** (`hermesVersion` above is recorded in `meta.json`
  and checked in CI).
- **No timestamps in the bundle.** Metro is invoked with
  `--reset-cache --dev=false --minify=true` and the Hermes step does not
  embed wall-clock time (`hermesc` is deterministic given a fixed input JS).
- **Sorted, stable module IDs.** Metro's default numeric module IDs are
  insertion-order-dependent; TH1.2 passes a `createModuleIdFactory` that
  sorts by source path so reordering unrelated files cannot renumber a
  module.
- **Filesystem walk order.** The source-tar (TH4.2) walks `CodeFileSystem`
  in sorted path order, so Metro sees files in the same order on every
  build.

Any remaining non-determinism source (e.g., a transitive native dep that
bakes in a build-id) must be documented inline in `apps/cf-esm-builder/container/build.sh`
and surfaced in `meta.json` as an explicit field — silent drift is a Phase H
bug.

---

## HTTP surface (`GET /bundle/:hash/*`)

`cf-esm-builder`'s `routes/bundle.ts` (TH2.3) and `cf-esm-cache`'s proxy
(TH3.1) both serve these files under the same URL shape. The hash is
content-addressable, so the cache headers are aggressive:

| Header | Value |
|---|---|
| `content-type` | `application/javascript` (for `.bundle`) / `application/json` (others) |
| `cache-control` | `public, max-age=31536000, immutable` |
| `etag` | `"${bundleHash}"` (quoted, per RFC 7232) |
| `x-hermes-version` | from `meta.json` (debug aid for scenario 12) |

- `max-age=31536000, immutable` means a year-long browser cache plus a
  hard "never revalidate" hint — safe because the URL itself changes when
  the content changes.
- `GET /bundle/:hash` alone (no sub-path) is an alias for
  `GET /bundle/:hash/index.android.bundle` so the Expo manifest's
  `launchAsset.url` can be a single short URL.

---

## Phase H consumer map

| Task | Role | What it reads/writes |
|---|---|---|
| **TH1.2** | Container build script (writer) | Produces all 5 files above; guards magic header before `put()`; writes `meta.json` last. |
| **TH2.3** | `cf-esm-builder` `GET /bundle/:hash` (reader) | Streams from R2 with the headers above. Returns 404 if `meta.json` is missing. |
| **TH3.1** | `cf-esm-cache` (proxy + cache) | Stale-while-revalidate proxy of `cf-esm-builder`; mirrors the same key shape into its own R2 binding. |
| **TQ1.1** | `cf-expo-relay` manifest builder | Reads `manifest-fields.json`, rewrites `launchAsset.url` to the cache host, returns the Expo manifest JSON. |
| **Scenario 09** | E2E — builder bundle fetch | `GET /bundle/:hash` from `cf-esm-cache` returns 200 + magic header. |
| **Scenario 10** | E2E — relay manifest | Manifest `launchAsset.url` resolves back to a valid Hermes bundle. |
| **Scenario 12** | Hermes magic header | Reads first 4 bytes of `GET /bundle/:hash` and asserts `c6 1f bc 03`. |

---

## Cross-references

- `plans/expo-browser-builder-protocol.md` (TH0.2) — defines how a
  `bundleHash` is computed from the source-tar and how `GET /build/:id`
  surfaces the hash back to the editor.
- `plans/expo-browser-fixture-spec.md` (TR0.2) — the exact project this
  artifact format is first produced against (TH1.3 smoke test).
- `plans/expo-browser-implementation.md` §2.2 — the original `cf-esm-cache`
  R2 design that this doc extends from `esm-packages` to the new
  `expo-bundles` bucket.

When this spec changes, every task in the consumer map above must update
in lockstep — treat any edit here as a coordinated PR spanning
`TH1.2 + TH2.3 + TH3.1 + TQ1.1` plus the affected scenarios.
