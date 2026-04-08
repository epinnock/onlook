# Expo browser builder protocol — editor ↔ cf-esm-builder

**Owner task:** `TH0.2` (Wave H0 of `plans/expo-browser-e2e-task-queue.md`).
**Consumed by:** `TH2.0`/`TH2.1`/`TH2.3`/`TH2.4` (builder Worker routes) and
`TH4.1`/`TH4.2`/`TH4.3` (editor `services/expo-builder` client).
**Source plan:** `plans/expo-browser-implementation.md`, §2.1.
**Fixture transported:** `plans/expo-browser-fixture-spec.md` (seven files,
real Expo SDK 54 project).

This file locks the **HTTP-level contract** between the Onlook editor and the
`cf-esm-builder` Cloudflare Worker. Every downstream Wave H task reads route
shapes, header names, response bodies, and TypeScript interfaces from here —
there is one source of truth. When this spec changes, `TH2.1 + TH2.3 + TH4.1`
must update in lockstep (treat as a coordinated 3-task PR).

---

## Goal

The editor ships a project source tree to `cf-esm-builder`; the builder runs
Metro + Hermes inside a Container DO and writes a Hermes bytecode bundle plus
an assetmap to R2; the editor receives a stable URL it can embed in the
Expo Go QR code shown by Phase Q (`TQ3.2`). Identical source bytes must
produce an identical bundle URL so re-pushing a project that hasn't changed
is a zero-cost cache hit — no Container kick-off, no Metro work, no Hermes
recompile.

## Constraints

1. **Cloudflare Worker request body cap: 100 MB.** The fixture is ~60 LOC
   so this is not a near-term concern, but the protocol must reject oversized
   bodies with `413` before the DO is touched.
2. **Deterministic hashing on both sides.** The editor's `source-tar` writer
   and the builder's `lib/hash.ts` reader must agree on `sourceHash` bit-for-bit,
   otherwise cache hits silently miss and every keystroke retriggers a 30s
   Container build.
3. **Route responses MUST be plain JSON or the raw bundle bytes.** No
   SuperJSON, no custom envelope — this is a plain `fetch()`, not tRPC.
4. **No streaming multipart.** The body is one tar blob in one request. If
   we ever need streaming (e.g. SDK 55 with larger `node_modules`), that's
   a Sprint 5+ protocol bump.

---

## Endpoints

### `POST /build`

Uploads the project source tree as a tar archive. The builder hashes the
canonicalised tar, checks R2 for an existing bundle at that hash, and either
returns a cache hit immediately or enqueues a Container build session in a
Durable Object.

**Request**

- Method: `POST`
- Path: `/build`
- Headers:
  - `Content-Type: application/x-tar` (primary) **or** `application/gzip`
    (accepted alternate for a gzipped tar)
  - `X-Project-Id: <uuid>` — required; used for DO namespace scoping and
    per-project eviction
  - `X-Branch-Id: <uuid>` — required; used for DO namespace scoping
- Body: tar bytes (≤ 100 MB)

**Response: 200 OK**

```json
{
  "buildId": "01HXYZ...",
  "sourceHash": "c6a1fbc0...",
  "cached": true
}
```

- `cached: true` means an identical `sourceHash` already has a finished
  bundle at `R2:bundle/${sourceHash}`. `bundleHash` equals `sourceHash`
  (see §Hashing rules), so the editor can go straight to
  `GET /bundle/${sourceHash}` without polling `/build/:buildId`.
- `cached: false` means a Container session has been enqueued in the DO;
  the editor must poll `GET /build/:buildId` until the state resolves.

**Errors**

- `400 { "error": "malformed tar" }` — tar header parse failed, or a path
  escaped the root (`..`), or a file exceeded the individual-file cap
- `413 { "error": "body too large" }` — `Content-Length` > 100 MB
- `415 { "error": "unsupported content-type" }` — anything other than
  `application/x-tar` or `application/gzip`
- `400 { "error": "missing X-Project-Id" }` / `"missing X-Branch-Id"`

### `GET /build/:buildId`

Polled by the editor while a fresh build is running. Safe to poll every
500 ms with exponential backoff (Phase H4.3).

**Response: 200 OK**

```json
{
  "state": "building",
  "sourceHash": "c6a1fbc0...",
  "bundleHash": "c6a1fbc0...",
  "bundleSize": 1482910,
  "builtAt": "2026-04-07T12:34:56Z"
}
```

- `state: "pending" | "building" | "ready" | "failed"`
- `bundleHash` present iff `state === "ready"` (equals `sourceHash`)
- `bundleSize` present iff `state === "ready"`, in bytes, for QR-flow UX
- `builtAt` present iff `state === "ready"`, ISO-8601 UTC
- `error` present iff `state === "failed"`, human-readable stderr excerpt

**State transitions:** `pending → building → (ready | failed)`. No path from
`failed` back to `pending`; the editor must re-`POST /build` with a new (or
re-identical) tar to retry.

**404** if `buildId` is unknown (DO evicted or never existed).

### `GET /bundle/:hash`

Serves the Hermes bundle bytes from R2. This is the URL the editor puts in
the Expo Go manifest (`TQ2.2`) that the phone fetches.

**Response: 200 OK**

- `Content-Type: application/javascript`
- `Cache-Control: public, max-age=31536000, immutable`
- Body: raw Hermes bytecode (first four bytes = `c6 1f bc 03`, asserted in
  scenario 12 / `TH5.3`)

**404** if the hash is unknown in R2.

### `GET /assetmap/:hash`

Serves the `assetmap.json` that the Expo Go runtime uses to locate images,
fonts, and other bundled assets by their resolved module ID. The fixture in
`plans/expo-browser-fixture-spec.md` is intentionally asset-free for R0, so
this endpoint legitimately returns `{}` for the fixture hash.

**Response: 200 OK**

- `Content-Type: application/json`
- `Cache-Control: public, max-age=31536000, immutable`
- Body: `{}` (empty, for asset-free projects) or an Expo assetmap object

**404** if the hash is unknown.

### `GET /sourcemap/:hash`

Optional, served on-demand for devtools. Not required for Phase H5 scenarios
to pass — only `GET /bundle/:hash` and `GET /assetmap/:hash` are in the hot
path.

**Response: 200 OK**

- `Content-Type: application/json`
- `Cache-Control: public, max-age=31536000, immutable`
- Body: source map JSON

**404** if the hash is unknown or the build didn't emit a sourcemap.

### `GET /health`

Polled by `scripts/dev-builder.sh` (`TH0.4`) to determine whether the
Container binding is live locally.

**Response: 200 OK**

```json
{ "ok": true, "version": "0.1.0", "container": "ready" }
```

- `container: "ready" | "missing"` — `"missing"` when the Container DO
  binding is absent (e.g. `wrangler dev` without `--x-containers`)

---

## Source-tar shape

The tar body sent to `POST /build` must follow these rules so the builder's
`lib/hash.ts` can derive a deterministic hash and so Metro inside the
Container can find the project root:

- **Flat tar, no leading directory.** Entries are at top level
  (`package.json`, `App.tsx`, `components/Hello.tsx`), not under a
  `fixture/` prefix. The Container untars into a fresh temp dir, so a
  leading directory would just double-nest.
- **Includes (from `plans/expo-browser-fixture-spec.md`):**
  - `package.json`
  - `app.json`
  - `babel.config.js`
  - `tsconfig.json`
  - `index.ts` (the Expo entry that calls `AppRegistry.registerComponent`)
  - All `.tsx`, `.ts`, `.jsx`, `.js` files under the project root
- **Excludes (the editor's `source-tar.ts` must skip these):**
  - `node_modules/` — the Container installs its own
  - `.git/` — not needed by Metro
  - `.expo/` — Expo CLI's build cache, varies per machine
  - `dist/`, `build/` — transient outputs
- **Content-Type:** `application/x-tar` is the canonical form. The builder
  also accepts `application/gzip` as an alternate (a gzipped tar); the
  builder transparently decompresses before hashing so `sourceHash` is
  identical whether the editor sent compressed or uncompressed bytes.

---

## Hashing rules

Both sides MUST produce the same `sourceHash` for the same logical source
tree, regardless of tar packing order or gzip compression:

1. **Canonical-sort entries by path** (lexicographic, byte-wise) before
   hashing. Tar packing order is writer-dependent — sorting is the only way
   to get bit-identical hashes across writers.
2. **Hash is SHA256 over the concatenation of `(path, content)` pairs.**
   Pseudocode:
   ```
   const sorted = entries.sort(byPath);
   const h = sha256.create();
   for (const { path, content } of sorted) {
     h.update(utf8(path));
     h.update([0]);           // NUL separator, unambiguous
     h.update(uint64BE(content.length));
     h.update(content);
   }
   return hex(h.digest());
   ```
3. **`bundleHash === sourceHash`.** For a cache hit we return the hash we
   already have; for a fresh build we run Metro + Hermes deterministically
   (same input → same output → same hash). The two are intentionally
   identical so `GET /bundle/:hash` is the single read path — there's no
   "source vs bundle" hash distinction to track in the editor client.

The determinism assumption relies on Metro and Hermes producing
byte-identical output for the same input, which the `TH5.3` scenario will
assert on real fixture bundles. If that assumption ever breaks, we fall
back to storing `bundleHash` separately in R2 metadata — but the wire
protocol doesn't change because `bundleHash` is already its own field in
the `GET /build/:buildId` response.

---

## Build state machine

```
          POST /build (cache miss)
                    │
                    ▼
             ┌──────────┐
             │ pending  │  — queued in DO, Container not yet started
             └────┬─────┘
                  │ DO spins Container
                  ▼
             ┌──────────┐
             │ building │  — Container running Metro + Hermes
             └────┬─────┘
            ┌─────┴─────┐
            ▼           ▼
      ┌─────────┐ ┌─────────┐
      │  ready  │ │ failed  │
      └─────────┘ └─────────┘
         │             │
  R2:bundle/${hash}    error stored in DO state
  R2:assetmap/${hash}  ~10 min, then evicted
```

- `pending`: DO has the build record but the Container hasn't started.
- `building`: Container is running `bunx expo export:embed` (see `TH1.3`
  smoke fixture command).
- `ready`: bundle bytes written to `R2:bundle/${hash}`, assetmap to
  `R2:assetmap/${hash}`. State is permanent until the DO is manually evicted.
- `failed`: error message pinned in DO state for ~10 minutes so the editor
  has time to fetch and display it, then evicted.

---

## Idempotency

- **Re-POST within the cache window.** The same tar (same `sourceHash`)
  posted twice returns `{ cached: true, bundleHash, ... }` both times. The
  second POST does NOT enqueue a second Container session.
- **Re-GET of `/build/:buildId` after `ready`.** Returns the same body
  indefinitely until the DO is evicted. Safe for the editor to re-poll on
  navigation / reload.
- **Re-GET of `/bundle/:hash` and `/assetmap/:hash`.** Idempotent, content-
  addressed by hash, served from R2 with `immutable` cache-control.

---

## Errors and retries

- **Container OOM** → `state: "failed"`, `error` includes the OOM marker
  (`/proc/self/oom_score` or Node's `heap out of memory` stderr line).
- **Metro syntax error** → `state: "failed"`, `error` includes `file:line`
  from Metro's stderr so the editor can surface it inline.
- **Hermes compile error** → `state: "failed"`, `error` includes Hermes's
  stderr excerpt (first ~500 chars).
- **Editor retry policy.** On `failed`, the editor displays the error and
  waits for the user to fix their code. **No auto-retry** — failures are
  user-fixable (syntax, OOM from a real pathological import), not flaky.
  The next user keystroke that triggers a re-build will naturally re-POST
  with a new `sourceHash`.

---

## TypeScript interface stubs

These are the source of truth for `TH4.1`
(`apps/web/client/src/services/expo-builder/types.ts`) and for the builder-side
`TH2.0` route type exports. Implementations on both sides must match these
shapes byte-for-byte.

```ts
export interface BuildRequestHeaders {
  'Content-Type': 'application/x-tar' | 'application/gzip';
  'X-Project-Id': string;
  'X-Branch-Id': string;
}
```

```ts
export interface BuildResponse {
  buildId: string;
  sourceHash: string;
  cached: boolean;
}
```

```ts
export type BuildState = 'pending' | 'building' | 'ready' | 'failed';

export interface BuildStatus {
  state: BuildState;
  sourceHash: string;
  bundleHash?: string;   // present iff state === 'ready'
  bundleSize?: number;   // bytes, present iff state === 'ready'
  builtAt?: string;      // ISO-8601 UTC, present iff state === 'ready'
  error?: string;        // present iff state === 'failed'
}
```

```ts
export interface HealthResponse {
  ok: boolean;
  version: string;
  container: 'ready' | 'missing';
}
```

```ts
export interface BuildError {
  error: string;
}
```

---

## Cross-references

- **`TH2.0`** scaffolds `apps/cf-esm-builder/src/routes/{build,bundle,health}.ts`
  and `lib/hash.ts` with empty exports that satisfy these interfaces.
- **`TH2.1`** implements `POST /build` + the tar hash + R2 cache check.
- **`TH2.3`** implements `GET /bundle/:hash` — must set the exact
  `Cache-Control` header defined here.
- **`TH2.4`** implements `GET /health` — must return the exact
  `HealthResponse` shape.
- **`TH4.1`** re-exports these interfaces from the editor side via a
  workspace-relative import; no drift allowed.
- **`TH4.2`** generates the tar body following the §Source-tar shape rules
  and pins the expected `sourceHash` against the fixture in
  `plans/expo-browser-fixture-spec.md`.
- **`TH4.3`** implements the HTTP client (`postSource`, `getStatus`,
  `getBundleUrl`) on top of these routes.
