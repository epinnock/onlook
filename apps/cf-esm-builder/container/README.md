# cf-esm-builder Container

This directory contains the Cloudflare Container image that runs Metro + Hermes
to produce real Expo Go bundles for Phase H of the ExpoBrowser project. The
Container is invoked by the `BuildSession` Durable Object inside the
`cf-esm-builder` Worker (see `apps/cf-esm-builder/src/do/build-session.ts`).

## What this container does

Given a tar archive of an Expo SDK 54 project on stdin, the container:

1. **Extracts** the source tree to `/work` (`lib/extract-source.sh`)
2. **Installs** project deps with `npm install --silent` against the work tree
3. **Runs Metro** via `expo export:embed --platform android --dev false --minify true` to produce a JS bundle (`lib/run-metro.sh`)
4. **Runs Hermes** via `hermes -O -emit-binary` to compile the JS bundle to bytecode (`lib/run-hermes.sh`)
5. **Verifies** the Hermes magic header (`0xc6 0x1f 0xbc 0x03`) on the output bytecode
6. **Emits** the artifact set to `/output`:
   - `index.android.bundle` (Hermes bytecode — what Expo Go's runtime loads)
   - `index.android.bundle.js` (the pre-Hermes JS bundle, for debugging)
   - `assetmap.json` (Metro asset manifest, currently empty for fixtures with no assets)
   - `sourcemap.json` (Metro source map)
   - `manifest-fields.json` (Expo manifest field set the relay reads — see TQ0.2)
   - `meta.json` (build metadata: builtAt, sizeBytes, hermesVersion, expoSdkVersion)
7. **Prints a JSON summary** to stdout that the cf-esm-builder Worker reads

The `bundleHash` field in the artifact set is a placeholder. The
`cf-esm-builder` Worker computes the deterministic source hash post-extraction
and patches the artifact set before writing to R2. This separation lets the
Container be content-agnostic — the same image can be cached by Docker layer
hash regardless of the source it processes.

## Image layout

```
apps/cf-esm-builder/
├── Dockerfile                # TH1.1 — multi-stage Node 20 + Expo CLI + Hermes
├── .dockerignore             # Excludes node_modules, .git, etc.
├── wrangler.jsonc            # TH1.4 — Container + BuildSession DO + BUNDLES R2 binding
├── .dev.vars.example         # Local dev env vars
└── container/
    ├── README.md             # ← you are here
    ├── build.sh              # TH1.2 — entrypoint, /usr/local/bin/build.sh
    ├── lib/
    │   ├── extract-source.sh # tar → /work
    │   ├── run-metro.sh      # /work → /output/index.android.bundle.js
    │   └── run-hermes.sh     # /output/.bundle.js → /output/index.android.bundle (Hermes)
    └── __tests__/
        ├── smoke.sh          # TH1.3 — bash smoke test against the minimal-expo fixture
        └── fixtures/minimal-expo/  # TH1.3 — smallest valid Expo SDK 54 project
```

## Pinned versions

| Component | Version | Why pinned |
|---|---|---|
| Base image | `node:20-bookworm-slim` | glibc (Hermes ships glibc binaries — Alpine breaks) |
| Expo SDK | `54.0.0` | Matches the fixture spec (TR0.2) and Onlook editor's `react: 19.2.0` |
| `@expo/cli` | `0.24.24` | Pinned exact, no `latest` |
| `react-native` | `0.81.0` | Source of the Hermes binary at `node_modules/react-native/sdks/hermesc/linux64-bin/hermesc` |

Bumping any of these requires re-validating the bundle artifact format (TH0.3)
and re-running scenarios 08, 09, 12 to confirm the Hermes magic header is still
correct.

## Building the image locally

```bash
cd apps/cf-esm-builder
docker build -t cf-esm-builder:dev .
```

Cold-build time: roughly 5–15 minutes on M1/M2 Mac with `docker buildx`. The
two long phases are:
- `apt-get install build-essential` (~30s)
- `npm install -g expo + react-native + @expo/cli` (~5–10 min, network-bound)

After the first build, layer caching brings rebuilds to ~30 seconds unless the
Dockerfile changes.

Image size target: ≤ 800 MB. Current image is multi-stage; the runtime stage
contains only `/usr/local/lib/node_modules`, `/usr/local/bin/{expo,hermes}`, and
the entrypoint scripts.

## Running the smoke test

```bash
docker run --rm \
    -v "$(pwd)/container/__tests__/fixtures/minimal-expo:/input/source" \
    cf-esm-builder:dev \
    bash /usr/local/bin/build.sh
```

Or use the bash smoke script (which auto-tars the fixture):

```bash
bash apps/cf-esm-builder/container/__tests__/smoke.sh
```

The smoke script asserts:
- `/output/index.android.bundle` exists and is non-empty
- The first 4 bytes of `index.android.bundle` are `c6 1f bc 03` (Hermes magic header)
- The bundle contains the unique `TH1.3-minimal-expo-fixture-v1` marker (so a stale `/tmp` bundle from an unrelated run can't masquerade as success)

The smoke script is **not run during validation** — it's run by a human or CI
when validating the Container image works. It documents the contract.

## Wiring into cf-esm-builder Worker

The Worker (`src/worker.ts`) routes `POST /build` to the `BuildSession` DO
(`src/do/build-session.ts`). The DO opens a TCP connection to its Container
instance (managed by Cloudflare via the `containers` block in
`wrangler.jsonc`), pipes the source tar in, reads the JSON return on stdout,
and patches the `PLACEHOLDER_HASH` strings in the R2 artifact set with the real
deterministic hash.

The flow looks like:

```
editor (apps/web/client/src/services/expo-builder/client.ts)
  └→ POST /build  (application/x-tar)
      └→ cf-esm-builder Worker (apps/cf-esm-builder/src/routes/build.ts)
          ├→ sha256OfTar() → sourceHash
          ├→ check R2 for bundle/<hash>/meta.json → 200 cached if hit
          └→ env.BUILD_SESSION.idFromName(hash).fetch()
              └→ BuildSession DO (apps/cf-esm-builder/src/do/build-session.ts)
                  └→ container.tcp.write(sourceTar) ; container.tcp.read() → JSON
                      └→ Container build.sh
                          ├→ extract-source.sh
                          ├→ run-metro.sh    (~2 min cold, ~20s warm)
                          ├→ run-hermes.sh   (~1s)
                          └→ JSON to stdout
                  ├→ patch PLACEHOLDER_HASH in R2 artifact set
                  └→ Response { bundleHash, sizeBytes, builtAt, hermesVersion }
```

## Local dev with `wrangler dev`

```bash
bash scripts/dev-builder.sh
# → starts wrangler dev on port 8788
# → boots a local Container instance via the `containers` block
# → posts /health, /build, /bundle/:hash etc. against http://127.0.0.1:8788
```

`scripts/dev-builder.sh` (TH0.4) pre-flights for Docker daemon presence and
exits clean with `[dev-builder] ERROR: Docker daemon not running` if Docker
isn't up.

**Important:** Cloudflare Containers requires a CF account with Containers
enabled (open beta). `wrangler dev --local` does work for the routing layer,
but the actual Container instance startup depends on a real CF account.
Without one, the BuildSession DO will return an error when it tries to open
the TCP connection. For pure-CI Docker testing, use `docker run` against the
image directly with the smoke script.

## Phase H scenarios this enables

| # | Scenario | Verifies |
|---|---|---|
| 08 | Editor source-tar reaches cf-esm-builder | The `POST /build` round-trip from `services/expo-builder/client.ts` → cf-esm-builder Worker → Container → JSON return, with a real bundleHash |
| 09 | `GET /bundle/:hash` returns Hermes bundle | The R2 read path through cf-esm-cache, verified by checking the response is `application/javascript` with the correct ETag |
| 10 | Manifest URL returns valid Expo manifest | Phase Q's relay (`cf-expo-relay`) builds an Expo Updates v2 manifest from the artifact set, with `launchAsset.url` pointing at cf-esm-cache |
| 11 | Preview-on-device button opens QR modal | Editor UI walk through `usePreviewOnDevice` hook → QrModal |
| 12 | Hermes magic header check on bundle URL | The first 4 bytes of `GET /bundle/:hash` match `c6 1f bc 03` |
| 13 | Edit triggers new bundleHash within 5s | Source-tar with a different file content produces a different deterministic hash |
| 14 | Manual phone scan with real Expo Go | Human-only; phones see the manifest URL via QR and load the bundle |

Scenarios 08–13 are walked via Chrome MCP through the
`verify-with-browser` skill against a live `dev-builder.sh` + `dev-relay.sh` +
editor stack. Scenario 14 is dead-lettered until a human marks it `passed`.

## Known limitations

- **No incremental build cache.** Every unique source tar triggers a fresh
  Metro run. Metro's own cache is reset (`--reset-cache`) for determinism.
  Layer caching at the Docker level handles repeat builds of the SAME source
  tar via the cf-esm-builder Worker's R2 hash check.
- **No assets pipeline.** `assetmap.json` is currently emitted as an empty
  array. Real asset handling (images, fonts) is a Sprint 4 task.
- **Linux/x86 only.** The Hermes binary copied from `react-native` is
  `linux64-bin/hermesc`. Cross-arch builds (arm64) need a different binary.
  Cloudflare Containers run on x86_64 so this is fine for production.
- **No source map upload.** `sourcemap.json` is written to the artifact set
  but not yet served by `cf-esm-cache`. Sentry / similar integrations are
  Sprint 4.
- **No incremental Hermes.** Each build re-compiles the entire bundle. Hermes
  doesn't natively support incremental compilation; the optimization here is
  just R2 caching by source hash.

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `[run-hermes] ERROR: missing magic header` | The JS bundle was empty or Hermes failed silently | Check Metro logs in stderr for syntax errors in the user's source |
| `npm install` hangs | Network issue or registry down | Set `NPM_CONFIG_REGISTRY` to a mirror |
| Container OOM | Standard-3 instance type isn't enough for large projects | Bump `instance_type` in `wrangler.jsonc` or split the build into stages |
| `expo export:embed: command not found` | Expo CLI install in deps stage failed | Re-run `docker build --no-cache` |
| Wrangler can't find Container | CF account doesn't have Containers enabled | Apply for the open beta or run the Container directly with `docker run` |

## References

- `plans/expo-browser-implementation.md` — canonical spec
- `plans/expo-browser-bundle-artifact.md` — TH0.3 artifact format
- `plans/expo-browser-builder-protocol.md` — TH0.2 source-push protocol
- `plans/expo-browser-builder-audit.md` — TH0.1 current state of cf-esm-builder
- `plans/expo-browser-e2e-task-queue.md` — full task queue (Phase H sections)
