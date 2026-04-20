# MC6.6 — Android Play Store Internal-Track Build Config

Scope of task MC6.6 in
`plans/onlook-mobile-client-task-queue.md`: wire the Android half of
`eas.json` + build scripts so the Onlook Mobile Client can produce Play
Store Internal Testing-eligible builds via Expo Application Services
(EAS). Mirrors MC6.5's iOS TestFlight lane.

This doc covers the three things a new maintainer needs to know:

1. Prerequisites (Google Play Console + service account JSON +
   `EXPO_TOKEN` + `GOOGLE_PLAY_SERVICE_ACCOUNT_KEY`).
2. How to run a local EAS build against this workspace.
3. How the CI pipeline invokes EAS (dry-run by default, real submit
   gated on secrets — wired by MC6.8).

> **Gate:** MCF8c (Android `expo prebuild`) is deferred at the time
> MC6.6 merges. Until MCF8c lands, the `--submit` path of
> `scripts/build-play-internal.sh` will fail at `eas build` because the
> generated `android/` directory does not yet exist. The `--dry-run`
> path exercises only `eas.json` schema validation, so it stays green
> through the gap.

---

## 1. Prerequisites

Before anything in this doc will produce an uploadable `.aab`, the
following must be in place:

### Google side

- **Google Play Console account** on the `onlook` organization with
  **Release Manager** or higher role on the `com.onlook.mobile` app
  record (matches `apps/mobile-client/app.config.ts` `android.package`).
- **App record registered** in Play Console for `com.onlook.mobile`.
  The first time the record is created it must be done manually in Play
  Console — EAS cannot create Play Console apps, only manage build
  uploads for existing ones. An initial "placeholder" `.aab` must also
  be uploaded manually to create the first app release (Play Console
  refuses `eas submit` uploads to apps that have zero prior releases).
- **Service account JSON** with the **Google Play Android Developer API**
  enabled and the **Release Manager** Play Console role. Generate via
  Google Cloud Console → IAM & Admin → Service Accounts → Keys → Add
  Key → JSON. Download the `.json` once; Google does not allow
  re-download.
- **Internal testing track** opened in Play Console → Testing → Internal
  testing. Add at least one tester email so the first `eas submit
  --track internal` upload has a destination.

### Expo side

- **Expo account** with permission on the `onlook` owner/org (same
  account used for MC6.5's iOS TestFlight lane; no new account needed).
- **`extra.eas.projectId` in `app.config.ts`** set to the project ID
  that `eas init` produces. Shared with MC6.5 — the Expo project is
  platform-agnostic; iOS and Android both live under the same
  `projectId`.
- **`EXPO_TOKEN` secret** stored in GitHub Actions repo secrets. Shared
  with MC6.5. Generate via
  <https://expo.dev/accounts/[account]/settings/access-tokens>.
- **`GOOGLE_PLAY_SERVICE_ACCOUNT_KEY` secret** stored in GitHub Actions
  repo secrets as the raw JSON body (not base64). The CI job wired by
  MC6.8 reads this env var and writes it to
  `apps/mobile-client/google-play-service-account.json` immediately
  before invoking `eas submit`, then deletes the file via a `trap EXIT`
  so the key never persists in the runner workspace.

### Local toolchain

- Android SDK (Android Studio bundled) for optional `eas build --local`
  runs. Set `ANDROID_HOME` in the shell environment so
  `scripts/build-play-internal.sh` detects it.
- JDK 17 (Android Gradle Plugin 8.x requirement; matches EAS image
  `latest`).
- `bun` 1.3.6+ (repo baseline).
- `eas-cli` via `bun x eas-cli` — no global install needed.

---

## 2. Running a local EAS build

Three entry points are wired in `apps/mobile-client/package.json`:

```bash
# Dry-run: validates eas.json schema + (with Android SDK) runs a local no-upload build.
bun run mobile:build:play-internal             # delegates to scripts/build-play-internal.sh --dry-run

# Cloud build only (produces an .aab, does not submit):
bun run eas:build:preview:android              # eas build --profile preview --platform android --non-interactive

# Cloud build + Play Internal submit in one go:
bun run eas:submit:preview:android             # eas submit --profile preview --platform android --non-interactive --track internal
```

### Build profiles defined in `eas.json`

| Profile       | `android.buildType` | `android.image` | Intended use                                     |
|---------------|---------------------|-----------------|--------------------------------------------------|
| `development` | `apk`               | `latest`        | dev-client builds for fast local iteration       |
| `preview`     | `apk`               | `latest`        | Play Internal-eligible testing (sideload-able)   |
| `production`  | `app-bundle`        | `latest`        | Play Store production submission (`.aab`)        |

`development` additionally pins `gradleCommand: ":app:assembleDebug"`
to skip Google Play signing ceremony for local dev-client installs.
`production` sets `autoIncrement: true` at the profile level so EAS
bumps `versionCode` on each upload — decoupled from the binary
`version` (`versionName`) which MC6.1 pins to
`ONLOOK_RUNTIME_VERSION` via `app.config.ts`.

### Submit profiles

Both `preview` and `production` carry an `android` submit block:

```json
"android": {
    "serviceAccountKeyPath": "./google-play-service-account.json",
    "track": "internal",
    "releaseStatus": "draft",
    "changesNotSentForReview": false
}
```

- `serviceAccountKeyPath` resolves relative to `apps/mobile-client/`.
  The path is a placeholder — CI materializes the file from
  `GOOGLE_PLAY_SERVICE_ACCOUNT_KEY` right before calling `eas submit`.
  Locally, drop the JSON at that path (gitignored — the filename is
  excluded via `.gitignore` as `google-play-service-account.json`).
- `track: internal` targets the Play Console Internal Testing track
  for `preview`. `production` points at `track: production` but retains
  `releaseStatus: draft` so even the production lane requires a manual
  Play Console click-through to roll out to real users.
- `changesNotSentForReview: false` ensures each upload enters the
  standard Play review queue. Flip to `true` only for the very first
  internal upload if the app has no prior reviewed release (Play rules
  require the first production rollout to be reviewed, but internal
  drafts can be pushed through without review).

### First-time local setup

```bash
cd apps/mobile-client

# 1. Log into Expo (interactive one-time; shared with iOS MC6.5 setup).
bun x eas-cli login

# 2. Link the workspace to an Expo project (no-op if MC6.5 already did this).
bun x eas-cli init

# 3. Place the service account JSON at the path eas.json expects.
cp ~/Downloads/onlook-play-service-account.json ./google-play-service-account.json

# 4. Dry-run the preview profile to sanity-check eas.json + credentials.
bun run mobile:build:play-internal             # ==  scripts/build-play-internal.sh --dry-run

# 5. Cloud build + submit once the dry-run is green (requires MCF8c
#    Android prebuild to exist; otherwise eas build errors out).
bun run eas:build:preview:android
bun run eas:submit:preview:android
```

`scripts/build-play-internal.sh` auto-detects whether the host has an
Android SDK + `android/` prebuild:

- **Host with `ANDROID_HOME` + `apps/mobile-client/android/`** →
  invokes `eas build … --local --output /tmp/onlook-mobile-preview.apk`
  so the build runs entirely locally and never hits the Expo build
  farm.
- **Linux host / sandbox without SDK** → falls back to `eas-cli config
  --profile preview --platform android` to exercise just the JSON
  schema. If the host is offline (no eas-cli), it degrades further to
  a `json.load` validation of `eas.json` so the script stays exit-0 in
  CI smoke paths.

---

## 3. CI invocation (dry-run by default, real submit gated)

The CI pipeline lives in `.github/workflows/mobile-client.yml`. Today
the Play-related slot (`play-dryrun`) is a placeholder filled by
MC6.6's merge and later fleshed out by **MC6.8**. Contract for that
job:

1. **Always runs** on `push` to `feat/mobile-client` once
   `apps/mobile-client/eas.json` exists (the workflow's existing
   `hashFiles('apps/mobile-client/eas.json') != ''` gate stays as-is).
2. **Dry-run by default**: invokes
   `bash apps/mobile-client/scripts/build-play-internal.sh` with no
   args. This validates `eas.json` and — on a runner with Android SDK
   + prebuild — builds the `.apk` locally without uploading. Zero
   credit consumed on the Expo build farm; zero risk of accidental
   Play Console pushes from a feature branch.
3. **Real submit gated on both secrets**: a separate job step
   conditionally runs `bash scripts/build-play-internal.sh --submit`
   **only when**:
   - the `EXPO_TOKEN` repo secret is present, and
   - the `GOOGLE_PLAY_SERVICE_ACCOUNT_KEY` repo secret is present, and
   - the workflow was dispatched manually with
     `workflow_dispatch.inputs.phase == 'play-store-upload'` — i.e. a
     maintainer explicitly asked for a Play push. A normal branch push
     never triggers the submit step even if both secrets are set.
4. **No-op on PRs**: the gate `github.event_name == 'push' &&
   github.ref == 'refs/heads/feat/mobile-client'` already restricts
   this to the integration branch, matching how the workflow handles
   the rest of Wave 6.

The `--submit` mode in `build-play-internal.sh` hard-fails with exit 3
when `EXPO_TOKEN` is empty and exit 4 when
`GOOGLE_PLAY_SERVICE_ACCOUNT_KEY` is empty, so a misconfigured
workflow cannot silently skip either check and succeed.

---

## 4. Gotchas

- **MCF8c must land before `--submit` works.** Android `expo prebuild`
  has not been run in this repo. `eas build --platform android`
  requires either (a) the generated `android/` directory committed, or
  (b) `expo prebuild --platform android` running at build time. EAS
  does the latter automatically on cloud builds; local `--local`
  builds need the prebuild committed. MCF8c will commit the prebuild
  output and unblock local Android builds.
- **Service account key handling.** Never commit the JSON to git. The
  file `google-play-service-account.json` at
  `apps/mobile-client/google-play-service-account.json` should be in
  `.gitignore` (add via MCF8c or a follow-up). CI writes it at job
  start and deletes it on `trap EXIT`.
- **First-upload paradox.** Play Console rejects `eas submit` to an
  app with zero prior uploads. A maintainer must manually upload a
  placeholder `.aab` once via Play Console UI before CI can take over
  internal-track pushes. This is a Play Console quirk, not an EAS
  limitation.
- **`versionCode` vs `versionName`.** `autoIncrement: true` in the
  `production` profile advances `versionCode` (Play-visible integer)
  on every EAS cloud build. `versionName` remains pinned to
  `ONLOOK_RUNTIME_VERSION` by `app.config.ts` — the two move
  independently. Same contract as iOS MC6.5's `buildNumber` vs
  `CFBundleShortVersionString`.
- **APK vs AAB.** `preview` builds produce an `.apk` for sideloading /
  ad-hoc device testing; `production` builds produce an `.aab` for
  Play Store ingest. Play Console's Internal Testing track accepts
  both formats, but AAB is required for the production track. The
  `preview` profile stays APK-only for faster iteration and
  sideload-friendliness.
- **`releaseStatus: "draft"` defaults for safety.** Both `preview`
  and `production` submit blocks default to `"draft"` so a maintainer
  must actively promote the upload in Play Console UI before it goes
  live to testers / store. Change to `"inProgress"` only when you
  want `eas submit` to ship directly to real users — almost never
  what you want from CI.
