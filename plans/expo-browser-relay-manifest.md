# Expo Go manifest format — cf-expo-relay response shape

**Owner task:** `TQ0.2` (Wave Q0 of `plans/expo-browser-e2e-task-queue.md`).
**Consumed by:** `TQ1.1` (`cf-expo-relay/src/manifest-builder.ts`), `TQ1.2`
(`src/routes/manifest.ts`), `TQ2.1` (`services/expo-relay/types.ts`),
scenario 10 (`10-relay-manifest.md`).
**Upstream inputs:** `plans/expo-browser-bundle-artifact.md` (TH0.3 —
`manifest-fields.json`), `plans/expo-browser-builder-protocol.md` (TH0.2 —
`bundleHash`), `plans/expo-browser-relay-audit.md` (TQ0.1 — why the current
stub at `src/session.ts:63-77` cannot be reused).
**Reference:** https://docs.expo.dev/versions/latest/sdk/updates/#manifest
(the EAS Update / Expo Updates v2 manifest shape — NOT the legacy `expo://`
manifest).

---

## Goal

A real phone running Expo Go scans a QR code whose payload is the URL
`https://<relay-host>/manifest/<bundleHash>`. Expo Go issues a plain
`GET` for that URL, expects a JSON body matching the shape below, then
follows `launchAsset.url` to pull the Hermes bundle bytes from
`cf-esm-cache` and executes them in-process under its bundled Hermes
runtime.

The relay does not serve bundle bytes itself. Its only job is to return a
well-formed manifest whose `launchAsset.url` (and any `assets[].url`) points
at the `cf-esm-cache` public host for the environment being served. SDK 54
Expo Go only accepts the Expo Updates v2 manifest shape — the legacy
`expo://` URL scheme and the old `{ bundleUrl, sdkVersion, ... }`
top-level manifest are both gone.

---

## Full example manifest

The following is what `GET /manifest/<bundleHash>` must return for the
seeded fixture (`expo-browser-fixture-spec.md`), with placeholder values
filled in:

```json
{
  "id": "c6a1fbc03d4e7f1234567890abcdef0123456789abcdef0123456789abcdef01",
  "createdAt": "2026-04-07T21:00:00.000Z",
  "runtimeVersion": "1.0.0",
  "launchAsset": {
    "key": "bundle-c6a1fbc03d4e7f1234567890abcdef0123456789abcdef0123456789abcdef01",
    "contentType": "application/javascript",
    "url": "https://cf-esm-cache.dev.workers.dev/bundle/c6a1fbc03d4e7f1234567890abcdef0123456789abcdef0123456789abcdef01"
  },
  "assets": [],
  "metadata": {},
  "extra": {
    "expoClient": {
      "name": "Onlook Preview",
      "slug": "onlook-preview",
      "version": "1.0.0",
      "sdkVersion": "54.0.0",
      "platforms": ["ios", "android"],
      "icon": null,
      "splash": { "backgroundColor": "#ffffff" },
      "newArchEnabled": true
    },
    "scopeKey": "@onlook/preview",
    "eas": {
      "projectId": null
    }
  }
}
```

A fixture with static assets (e.g. a bundled PNG icon) would populate
`assets` with one entry per file:

```json
{
  "key": "a1b2c3d4...icon",
  "contentType": "image/png",
  "url": "https://cf-esm-cache.dev.workers.dev/bundle/c6a1fbc0.../assets/icon.png",
  "fileExtension": ".png"
}
```

The seeded fixture intentionally ships **no** static assets so the first
end-to-end green scenario (TQ4.1 / scenario 10) can assert `assets: []`.

---

## Required response headers

| Header | Value | Why |
|---|---|---|
| `Content-Type` | `application/json` | Expo Go refuses anything else |
| `Cache-Control` | `no-cache, no-store` | Expo Go polls for updates; the manifest must always be fresh even though the bundle body is immutable-cached by hash |
| `expo-protocol-version` | `1` | Selects the Expo Updates v2 manifest dialect |
| `expo-sfv-version` | `0` | Structured Field Values version; `0` is the current wire format |
| `expo-signature` | *(omitted)* | Only present when signed updates are enabled. Phase Q dev/local never signs. Production tunneling can add this later; the builder does not need to emit a key |

The relay MUST NOT set `Cache-Control: immutable` or any `ETag` — that is
reserved for the bundle bytes served by `cf-esm-cache`, where the URL is
already content-addressable. Caching the manifest would break the "edit →
new bundleHash → new QR" loop (scenario 13 / TQ4.2).

---

## Field-by-field

| Field | Source | Notes |
|---|---|---|
| `id` | `manifest-fields.json` → relay sets it to `bundleHash` | Globally unique per manifest revision. `bundleHash` (from TH0.2) is already content-addressable, so reusing it satisfies the uniqueness rule and makes the manifest a pure function of the build output |
| `createdAt` | `meta.json#builtAt` (TH0.3), fallback to `new Date().toISOString()` | ISO-8601 UTC. Expo Go uses this to pick the newest of two manifests with the same `runtimeVersion` — we generally only serve one, but the field is required |
| `runtimeVersion` | Hardcoded `"1.0.0"` for Phase Q v1 | See "runtimeVersion decision" below |
| `launchAsset.key` | `manifest-fields.json#launchAsset.key` (e.g. `"bundle-<hash>"`) | Expo Go uses this as the local-cache key; does not need to be a URL |
| `launchAsset.contentType` | `manifest-fields.json#launchAsset.contentType` → always `"application/javascript"` | Even though the body is Hermes bytecode, Expo Go's updater pipeline keys off this MIME type. `cf-esm-cache`'s own `GET /bundle/:hash` handler already serves the bytes with the same `Content-Type` (see `expo-browser-bundle-artifact.md`) |
| `launchAsset.url` | **Computed by the relay**: `${cfEsmCachePublicUrl}/bundle/${bundleHash}` | MUST be the public `cf-esm-cache` host, not the internal `cf-esm-builder` host. The phone fetches this URL directly — the relay does not proxy bundle bytes |
| `assets` | `manifest-fields.json#assets`, with each entry's `url` rewritten to `${cfEsmCachePublicUrl}/bundle/${bundleHash}/<assetPath>` | Empty array for the seeded fixture |
| `metadata` | `manifest-fields.json#metadata` | Opaque to the relay; passes through as-is. The stock value is `{}` |
| `extra.expoClient` | `manifest-fields.json#extra.expoClient` (a redaction of `app.json`'s `expo` block) | Drives the Expo Go splash screen + the app-launcher card (name, icon, version). The fixture fills this with `"Onlook Preview"` defaults |
| `extra.scopeKey` | `manifest-fields.json#extra.scopeKey` (`"@onlook/preview"`) | Expo Go namespacing key; keeps our bundles from colliding with other SDK-54 apps in the dev client's cache |
| `extra.eas.projectId` | `null` | We are not an EAS project; omit the ID. Expo Go accepts `null` here |

---

## Relay computation split

What the relay **receives** (from `manifest-fields.json`, written by
`cf-esm-builder` per TH0.3):

- `runtimeVersion`
- `launchAsset.key`
- `launchAsset.contentType`
- `assets[]` (with asset-relative `url` paths, not absolute)
- `metadata`
- `extra.expoClient`
- `extra.scopeKey`

What the relay **computes** at request time:

- `id` — set to the `bundleHash` URL param
- `createdAt` — from `meta.json#builtAt`, falling back to `Date.now()` if
  the builder's clock was unavailable (the fallback is a Phase Q bug
  canary; log it)
- `launchAsset.url` — `${env.ESM_CACHE_PUBLIC_URL}/bundle/${bundleHash}`
- `assets[].url` — `${env.ESM_CACHE_PUBLIC_URL}/bundle/${bundleHash}/${asset.path}`
  (the `path` field comes from `manifest-fields.json`)
- `extra.eas.projectId` — hardcoded `null`

`ESM_CACHE_PUBLIC_URL` is a `vars` entry the relay reads at edge
runtime. TQ1.3 locks the name; dev picks the LAN-reachable `http://`
URL, production picks the `https://cf-esm-cache.<env>.workers.dev`
host.

---

## runtimeVersion decision

We hardcode `runtimeVersion: "1.0.0"` for Phase Q v1.

- Expo Go matches a manifest's `runtimeVersion` against its own bundled
  JS runtime + native code. Phase Q ships one Hermes + one Expo Go
  version pair, so one string suffices.
- We deliberately do **not** use `"exposdk:54.0.0"` (the older
  "policy-derived" form). SDK 54 Expo Go still accepts plain semver
  strings, and a free-form `"1.0.0"` lets us bump independently of SDK
  upgrades once we start shipping custom native code.
- When Phase H starts producing bundles whose native interface changes,
  the builder will bump its own `runtimeVersion` in `manifest-fields.json`
  and the relay will forward it unchanged — the relay has no opinion on
  the value, only on the field being present.
- `meta.json` already records the concrete `expoSdkVersion` /
  `hermesVersion` for debugging; `runtimeVersion` is a logical
  compatibility tag, not a version stamp.

---

## Validation rules (relay enforces)

1. `launchAsset.url` MUST be HTTPS in production. Dev allows `http://`
   because Expo Go in dev mode tolerates LAN-scoped HTTP — this is
   gated by `env.ALLOW_INSECURE_MANIFEST_URL`, which MUST be false in
   any non-dev deploy.
2. `id` MUST be the exact `bundleHash` from the URL param. The relay
   rejects mismatches between param and `manifest-fields.json` with
   `500 manifest-hash-mismatch` (canary for a cache-key bug).
3. `manifest-fields.json` MUST be JSON-parseable. If not, `500
   manifest-fields-malformed` — this fails fast so a bad build cannot
   poison the manifest endpoint.
4. `meta.json` presence is the "build is complete" sentinel. If it is
   missing, the relay returns `404 build-not-ready` (same contract as
   `cf-esm-builder`'s `GET /bundle/:hash` reader, per TH0.3).

---

## TypeScript interface stubs

These are the authoritative types — `TQ1.1` (`manifest-builder.ts`) and
`TQ2.1` (`services/expo-relay/types.ts`) must re-use them verbatim.

```ts
export interface ExpoLaunchAsset {
  key: string;
  contentType: "application/javascript";
  url: string;
}

export interface ExpoAsset {
  key: string;
  contentType: string;
  url: string;
  fileExtension: string;
}

export interface ExpoExpoClient {
  name: string;
  slug: string;
  version: string;
  sdkVersion: string;
  platforms: ReadonlyArray<"ios" | "android">;
  icon: string | null;
  splash: { backgroundColor: string };
  newArchEnabled: boolean;
}

export interface ExpoExtra {
  expoClient: ExpoExpoClient;
  scopeKey: string;
  eas: { projectId: string | null };
}

export interface ExpoManifest {
  id: string;
  createdAt: string;
  runtimeVersion: string;
  launchAsset: ExpoLaunchAsset;
  assets: ReadonlyArray<ExpoAsset>;
  metadata: Record<string, unknown>;
  extra: ExpoExtra;
}
```

`manifest-fields.json` deserialises into a narrower type that omits the
relay-computed fields — TQ1.1 will introduce `ManifestFieldsFile` next
to `ExpoManifest` and write a `buildManifest(fields, bundleHash, env):
ExpoManifest` helper that closes the gap.

---

## Caveats

1. **LAN IP, not `127.0.0.1`.** In local dev the manifest URL must
   encode the dev host's **LAN IP** (e.g. `http://192.168.1.42:8787`),
   not `localhost` — the phone cannot reach the developer machine's
   loopback interface. `scripts/dev-relay.sh` (TQ0.3) surfaces the LAN
   IP to the launcher; the editor's QR composition uses it. This is
   the single biggest gotcha when wiring a new dev environment.
2. **Expo Go dev mode is required for LAN/HTTP.** Expo Go's production
   manifest-fetch path refuses any non-HTTPS origin. Scanning a QR that
   points at `http://192.168.1.42:8787/manifest/<hash>` only works when
   Expo Go is in "Development" mode (toggle in the app's settings,
   enabled by default on a phone that has ever opened an Expo-CLI dev
   server). The onboarding doc in `plans/expo-browser-implementation.md`
   §3.2 must mention this before TH6.1.
3. **No `expo://`.** SDK 54 removed the legacy `expo://` URL scheme for
   the Expo Go launcher. All QR payloads must be plain `https://` (or
   LAN-scoped `http://` in dev). Do not resurrect the old
   `exp://<host>/--/...` form — it no longer resolves.
4. **Production tunnelling.** A production-grade phone test over a
   non-LAN network needs the relay to be reachable over HTTPS. That is
   out of scope for Phase Q — TH6.1 uses a LAN-only smoke test and any
   tunnel (ngrok, Cloudflare Tunnel) is future work.

---

## Cross-references

- `plans/expo-browser-bundle-artifact.md` — `manifest-fields.json`
  schema (the internal input format) and `meta.json` fields that feed
  `createdAt` / freshness gating.
- `plans/expo-browser-builder-protocol.md` — how `bundleHash` is
  computed and why it is the natural `id`.
- `plans/expo-browser-relay-audit.md` — inventory of the current
  `ExpoSession.handleManifest` stub and why it cannot be reused as-is.
- `plans/expo-browser-e2e-task-queue.md` — Wave Q1/Q2 task rows that
  consume this spec (TQ1.1, TQ1.2, TQ2.1, TQ4.1).
