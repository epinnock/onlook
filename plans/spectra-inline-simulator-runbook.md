# Runbook — Spectra inline simulator preview

How to stand up the Spectra-side prerequisites for Onlook's **In browser**
preview tab end-to-end, starting from nothing.

Scope: iOS simulator only. AWS Device Farm and physical-iPhone paths are
supported by Spectra but not surfaced to Onlook yet.

## 0. Prerequisites on the Onlook box

- `/home/boxuser/ui-automator` checkout on branch `feat/onlook-integration`
  (or later). Three commits you need: `POST /v1/devices/:id/open-url`,
  `installAppId` on device create, `GET /v1/devices/:id/mjpeg`.
- Local Docker, Node 22+, pnpm 9+. Spectra runs Postgres, Redis, MinIO, and
  the Scaleway SSH tunnel from your dev box — see Spectra's own README.
- A configured `.env` under `ui-automator/` with `SCW_SECRET_KEY` +
  `SCW_PROJECT_ID` (iOS simulators run on the Scaleway Mac mini).

## 1. Build the Onlook Mobile Client `.app` for iOS simulator

On the Mac mini (`ssh -i ~/.ssh/spectra-macmini scry-farmer@192.168.0.17`;
see `apps/mobile-client/docs/mac-mini-debugging.md`):

```bash
cd ~/onlook
git fetch origin
git checkout feat/mobile-client
bun install
bun run mobile:build:ios   # apps/mobile-client/scripts/run-build.ts
```

Output lives at
`apps/mobile-client/ios/build/Build/Products/Debug-iphonesimulator/OnlookMobileClient.app`.

Zip it (Spectra's upload endpoint + `xcrun simctl install` expect a zip):

```bash
cd apps/mobile-client/ios/build/Build/Products/Debug-iphonesimulator
ditto -c -k --keepParent OnlookMobileClient.app /tmp/OnlookMobileClient.app.zip
```

`ditto` is important — `zip` can lose the bundle's symlinks and `simctl
install` will reject the result silently.

## 2. Upload it to Spectra

Start Spectra (`bash start.sh` in `ui-automator/`), then from any box that
can reach the Spectra API:

```bash
scp /tmp/OnlookMobileClient.app.zip <onlook-host>:/tmp/   # if Spectra isn't on the Mac
curl -X POST http://localhost:3001/v1/apps \
  -F 'name=Onlook Mobile Client' \
  -F 'bundleId=com.onlook.mobileclient' \
  -F 'platform=ios' \
  -F 'version=0.1.0' \
  -F 'file=@/tmp/OnlookMobileClient.app.zip'
```

Capture the returned `id` — that's the UUID Onlook needs as
`SPECTRA_ONLOOK_MOBILE_CLIENT_APP_ID`.

## 3. Configure Onlook

In `apps/web/client/.env.local`:

```bash
SPECTRA_API_URL=http://localhost:3001
SPECTRA_API_TOKEN=                                 # leave blank in dev
SPECTRA_ONLOOK_MOBILE_CLIENT_APP_ID=<uuid-from-step-2>
NEXT_PUBLIC_FEATURE_SPECTRA_PREVIEW=true
```

You also need the existing `NEXT_PUBLIC_CF_ESM_BUILDER_URL` and
`NEXT_PUBLIC_CF_EXPO_RELAY_URL` for the build phase — same values the
"On device" QR flow uses.

## 4. Verify end-to-end

```bash
cd apps/web/client
bun run dev:client
```

1. Open any project with an ExpoBrowser branch.
2. Click **Preview on device** in the top bar.
3. Switch to the **In browser** tab.
4. Click **Launch simulator**. Expect:
   - `Building your project…`
   - `Starting simulator…` (can take ~30 s the first time a fresh sim is
     provisioned).
   - A new iPhone-shaped frame appears on the canvas with a live stream.
5. Click inside the frame — a pulse ring fires and the tap lands in the
   simulator ~200 ms later.
6. Close the modal. Confirm:
   ```bash
   curl http://localhost:3001/v1/devices | jq
   ```
   returns no leftover device with your session id.

## 5. Troubleshooting

| Symptom | Likely cause |
|---------|--------------|
| `PRECONDITION_FAILED: SPECTRA_ONLOOK_MOBILE_CLIENT_APP_ID is not set` | Step 3 missed. |
| `Device provisioned but app install failed` in the modal | Bundle upload corrupted — re-zip with `ditto`. |
| `Stream lost` right after launch | Mac mini's WDA didn't come up. `ssh` in and check `ps aux \| grep xcodebuild`. |
| Taps don't register | Sim booted before WDA was ready. Wait 10 s and retry; if persistent, close the modal and re-open. |
| Tab is disabled with "Simulator unavailable" | `spectra.health` returned unhealthy. `curl $SPECTRA_API_URL/health` from the Onlook server box. |

## 6. Production gate

This feature ships behind `NEXT_PUBLIC_FEATURE_SPECTRA_PREVIEW=false`.
Turning it on in Studio prod requires, at minimum:

- Spectra deployed at a stable URL with bearer-token auth
  (`SPECTRA_API_TOKEN` set on the Onlook server).
- A runner pool — the single-simulator constraint in v1 doesn't scale to
  real user load. See the ADR for the sketch.
- The Onlook Mobile Client `.app` uploaded to the production Spectra and
  its UUID set in the server env.
