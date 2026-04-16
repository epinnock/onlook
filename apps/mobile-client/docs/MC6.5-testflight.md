# MC6.5 — iOS TestFlight Build Config

Scope of task MC6.5 in
`plans/onlook-mobile-client-task-queue.md`: wire `eas.json` + build scripts so
the Onlook Mobile Client can produce TestFlight-eligible builds via Expo
Application Services (EAS).

This doc covers the three things a new maintainer needs to know:

1. Prerequisites (Apple Developer + App Store Connect + `EXPO_TOKEN`).
2. How to run a local EAS build against this workspace.
3. How the CI pipeline invokes EAS (dry-run by default, real submit gated on a
   secret — wired by MC6.7).

---

## 1. Prerequisites

Before anything in this doc will produce an uploadable artifact, the following
must be in place:

### Apple side

- **Apple Developer Program membership** (paid, ~$99/yr). Required to create
  provisioning profiles and submit to TestFlight.
- **App Store Connect app record** registered for the bundle identifier
  `com.onlook.mobile` (matches `apps/mobile-client/app.config.ts`
  `ios.bundleIdentifier`). The first time the record is created it must be
  done manually in App Store Connect — EAS cannot create App Store Connect
  records, only manage build uploads for existing ones.
- **Team ID, Apple ID, and ASC App ID** captured in `eas.json` under
  `submit.preview.ios` / `submit.production.ios`. Current values are
  placeholders (`APPLE_ID_PLACEHOLDER`, `ASC_APP_ID_PLACEHOLDER`,
  `APPLE_TEAM_ID_PLACEHOLDER`) that must be replaced before the first real
  submit.

### Expo side

- **Expo account** with permission on the `onlook` owner/org.
- **`extra.eas.projectId` in `app.config.ts`** set to the project ID that
  `eas init` produces. Currently empty — first real build will require running
  `bun x eas-cli init` on a machine that's logged in, which populates the ID
  and writes it back into `app.config.ts`.
- **`EXPO_TOKEN` secret** stored in GitHub Actions repo secrets. The CI job
  gated on this secret is MC6.7; see section 3 below. Generate the token via
  <https://expo.dev/accounts/[account]/settings/access-tokens>.

### Local toolchain

- Xcode 15.4+ (the workflow pins `macos-14` + `xcode-version: '15.4'`; keep
  local parity).
- `bun` 1.3.6+ (repo baseline).
- `eas-cli` via `bun x eas-cli` — no global install needed, Bun fetches on
  demand.

---

## 2. Running a local EAS build

Three entry points are wired in `apps/mobile-client/package.json`:

```bash
# Dry-run: validates eas.json schema + (on macOS) runs a local no-upload build.
bun run mobile:build:testflight                # delegates to scripts/build-testflight.sh --dry-run

# Cloud build only (produces an .ipa, does not submit):
bun run eas:build:preview                       # eas build --profile preview --platform ios --non-interactive

# Cloud build + TestFlight submit in one go:
bun run eas:submit:preview                      # eas submit --profile preview --platform ios --non-interactive
```

### Build profiles defined in `eas.json`

| Profile       | Distribution | `ios.simulator` | Intended use                                    |
|---------------|--------------|-----------------|-------------------------------------------------|
| `development` | internal     | true            | dev-client builds for fast local iteration      |
| `preview`     | internal     | true            | TestFlight-eligible internal / ad-hoc testing   |
| `production`  | store        | false           | App Store submission                            |

Both `development` and `preview` set `ios.simulator: true` so a dev without
Apple signing identities can still build a runnable `.app` via
`bun run mobile:build:testflight --dry-run`. The `production` profile omits
`simulator` (defaults to false) because it must produce a signed IPA.

### First-time local setup

```bash
cd apps/mobile-client

# 1. Log into Expo (interactive one-time).
bun x eas-cli login

# 2. Link the workspace to an Expo project. Writes the projectId into
#    app.config.ts's extra.eas.projectId.
bun x eas-cli init

# 3. Dry-run the preview profile to sanity-check eas.json + credentials.
bun run mobile:build:testflight   # ==  scripts/build-testflight.sh --dry-run

# 4. Cloud build once the dry-run is green.
bun run eas:build:preview
```

`scripts/build-testflight.sh` auto-detects whether it is running on a host
with `xcodebuild` available:

- **macOS runner** → invokes `eas build … --local --output /tmp/onlook-mobile-preview.ipa`
  so the build runs entirely locally and never hits the Expo build farm.
- **Linux host / sandbox** → falls back to `eas-cli config --profile preview
  --platform ios` to exercise just the JSON schema. If the Linux host is
  offline (no eas-cli), it degrades further to a `json.load` validation of
  `eas.json` to keep the script exit-0 in CI smoke paths.

---

## 3. CI invocation (dry-run by default, real submit gated)

The CI pipeline lives in `.github/workflows/mobile-client.yml`. Today the
TestFlight-related slot (`testflight-dryrun`) is a placeholder filled by
MC6.5's merge and later fleshed out by **MC6.7**. Contract for that job:

1. **Always runs** on `push` to `feat/mobile-client` once `apps/mobile-client/eas.json`
   exists (the workflow's existing `hashFiles('apps/mobile-client/eas.json') != ''`
   gate stays as-is).
2. **Dry-run by default**: invokes `bash apps/mobile-client/scripts/build-testflight.sh`
   with no args. This validates `eas.json` and — on the macOS runner — builds
   the `.ipa` locally without uploading. Zero credit consumed on the Expo
   build farm; zero risk of accidental TestFlight pushes from a feature branch.
3. **Real submit gated on `EXPO_TOKEN`**: a separate job step conditionally
   runs `bash scripts/build-testflight.sh --submit` **only when**:
   - the `EXPO_TOKEN` repo secret is present (job step uses `if: ${{
     secrets.EXPO_TOKEN != '' }}`), and
   - the workflow was dispatched manually with
     `workflow_dispatch.inputs.phase == 'testflight-dryrun'` — i.e. a
     maintainer explicitly asked for a TestFlight push. A normal branch push
     never triggers the submit step even if the secret is set.
4. **No-op on PRs**: the gate `github.event_name == 'push' && github.ref ==
   'refs/heads/feat/mobile-client'` already restricts this to the integration
   branch, matching how the workflow handles the rest of Wave 6.

The `--submit` mode in `build-testflight.sh` hard-fails with exit 3 when
`EXPO_TOKEN` is empty, so a misconfigured workflow cannot silently skip the
check and succeed.

---

## 4. Gotchas

- `extra.eas.projectId` in `app.config.ts` is still empty at time of MC6.5
  merge. First real `eas build` invocation will prompt for `eas init`; CI
  must either (a) commit the projectId after a maintainer runs `eas init`
  locally, or (b) pass `--no-wait` + project-id env var. The dry-run path
  does not require the ID.
- `cli.appVersionSource: "remote"` in `eas.json` tells EAS to manage
  `buildNumber` server-side. This intentionally **does not** touch the binary
  version (`CFBundleShortVersionString`), which MC6.1 pins to
  `ONLOOK_RUNTIME_VERSION` via `app.config.ts`. The two values move
  independently: runtime version = compatibility, buildNumber = incrementing
  upload counter.
- `cli.requireCommit: false` — CI builds run on detached commits produced by
  the workflow; requiring a clean tree would break dispatched re-runs.
- Simulator builds (profiles with `ios.simulator: true`) produce an **.app
  bundle**, not a signed `.ipa`. They cannot be uploaded to TestFlight. Use
  the `production` profile (or a future explicit `testflight-device` profile)
  when producing artifacts destined for App Store Connect. The `preview`
  profile as currently shaped is intentionally simulator-only for
  MC6.5 — real TestFlight ad-hoc distribution lands when Apple credentials
  are provisioned.
