# Binary Size Baseline — `OnlookMobileClient.app`

MCI.2 artifact. Captures the expected on-disk footprint of a built
`OnlookMobileClient.app` so that regressions (a rogue dependency, an
un-stripped debug section, a vendored asset explosion) show up as a
numeric delta in CI rather than as a vague "the app feels big" report
from a human tester.

**Measured by:** `apps/mobile-client/scripts/binary-size-audit.sh`
(pass `--app <path>`; defaults to newest under DerivedData).
**Consumed by:** future `mobile:audit:size` CI step in
`.github/workflows/mobile-client.yml` (MCI.2 Validate line).

The script's JSON output (stdout) is the machine-readable form; the
baseline numbers below come from that JSON. Anything in the "expected
ranges" table is a best-available estimate pending a real Mac-mini build
with the full Hermes toolchain — the Linux dev container in which this
task was implemented does not have Xcode, so a measured baseline must be
produced on the Mac mini runner and landed as a follow-up edit to this
file.

---

## 1. Expected ranges (pre-measurement, for Debug-iphonesimulator)

| Component            | Expected size | Rationale |
|----------------------|---------------|-----------|
| Total `.app`         | 40–80 MB      | Bare Expo SDK 54 + React Native 0.81 + Hermes, Debug-iphonesimulator (unstripped). Release-device variants trim ~40–50%. |
| `OnlookMobileClient` (main binary) | 1–4 MB      | Swift `AppDelegate` + `HermesBootstrap` + `OnlookRuntimeInstaller` TurboModule + Expo modules-core linkage. No native UI beyond splash/RCTRootView. |
| `onlook-runtime.js`  | 150–300 KB    | The `bundle-runtime.ts` output as of MC2.12 (React 19 reconciler + Onlook runtime shell). Ships as an uncompressed JS source string read by `HermesBootstrap`. |
| `main.jsbundle`      | 1.5–3 MB      | Hermes bytecode for `index.js` + `App.tsx` — the launcher + scan + settings + error screens (MC3.x). Debug builds include sourcemap-friendly metadata; release builds minify further. |
| `Frameworks/`        | 30–60 MB      | Hermes (`hermes.framework`), React Native, Expo modules, `ExpoCamera`, `ExpoSecureStore`, `ExpoHaptics` dylibs. This is usually the dominant slice. |

Top-10 files by size — expected ordering (approximate):

1. `Frameworks/hermes.framework/hermes`
2. `Frameworks/React-*.framework/*`
3. `Frameworks/ExpoCamera.framework/ExpoCamera`
4. `main.jsbundle`
5. `OnlookMobileClient` (main binary)
6. `Frameworks/ExpoSecureStore.framework/*`
7. `Frameworks/ExpoHaptics.framework/*`
8. `Frameworks/ExpoModulesCore.framework/*`
9. `onlook-runtime.js`
10. `Info.plist` / `PkgInfo` / `Assets.car`

If a Top-10 entry that is **not** in the expected list above climbs into
the top 5, that is a regression signal — investigate whether a new
dependency got pulled in by mistake.

## 2. Measured baseline

Status: **pending first Mac-mini run.** When producing the baseline:

```bash
# On the Mac mini runner, after a fresh prebuild + build:
bun run mobile:build:ios
./apps/mobile-client/scripts/binary-size-audit.sh > /tmp/baseline.json
jq . /tmp/baseline.json
```

Paste the resulting JSON (minus `generatedAt` / `appPath` which are
build-host-specific) into the "Measured baseline JSON" block below and
commit. Suggested commit message:
`chore(mobile-client): MCI.2 — fill in measured binary-size baseline`.

### Measured baseline JSON

```json
{
    "schemaVersion": 1,
    "appName": "OnlookMobileClient.app",
    "total": { "bytes": 0, "human": "TBD" },
    "components": {
        "mainBinary":    { "path": "OnlookMobileClient", "bytes": 0, "human": "TBD", "present": false },
        "onlookRuntime": { "path": "onlook-runtime.js",  "bytes": 0, "human": "TBD", "present": false },
        "mainJsBundle":  { "path": "main.jsbundle",      "bytes": 0, "human": "TBD", "present": false },
        "frameworks":    { "path": "Frameworks",         "bytes": 0, "human": "TBD", "present": false }
    },
    "top10Files": []
}
```

## 3. Regression thresholds (CI wiring for `mobile:audit:size`)

The MCI.2 Validate line in `plans/onlook-mobile-client-task-queue.md`
specifies:

> asserts iOS IPA ≤ 40MB, Android APK ≤ 35MB — calibration values;
> agent adjusts to observed baseline + 10%.

Until the measured baseline lands, use the following heuristic gates —
the CI step parses the JSON and fails if any threshold is exceeded:

| Asserted value              | Threshold (initial) | Source          |
|-----------------------------|---------------------|-----------------|
| `total.bytes`               | ≤ 84 MB             | 80 MB upper expected-range bound × 1.05 slack |
| `components.mainBinary.bytes`   | ≤ 5 MB          | 4 MB × 1.25 slack |
| `components.onlookRuntime.bytes`| ≤ 400 KB        | 300 KB × 1.33 (runtime churn during Wave 2–4) |
| `components.mainJsBundle.bytes` | ≤ 4 MB          | 3 MB × 1.33 slack |
| `components.frameworks.bytes`   | ≤ 70 MB         | 60 MB × 1.17 slack |

Once the measured baseline is committed, tighten every threshold to
`observed × 1.10` per the source-plan rule. Update this file and the CI
step in the same PR.

## 4. Script contract (stable across refactors)

The audit script exits 0 on success, 2 on "no `.app` found", 3 on
missing tool. Its stdout is **only** the JSON document — stderr carries
the human-readable summary. CI pipelines should:

1. Build the `.app` via `bun run mobile:build:ios`.
2. Capture: `./apps/mobile-client/scripts/binary-size-audit.sh > audit.json`.
3. Parse `audit.json` with `jq` (or any JSON tool).
4. Gate on the thresholds in section 3.
5. Upload `audit.json` as a workflow artifact for trend graphing.

## 5. How to update this file

When a Mac-mini build produces a new measured baseline:

1. Re-run the audit against the fresh build.
2. Paste the pruned JSON into section 2.
3. Recompute thresholds in section 3 as `observed × 1.10`.
4. Note the delta vs. the previous measurement in a short changelog line.

### Changelog

- 2026-04-11 — MCI.2: initial scaffold, expected-range estimates only.
  Measured baseline pending first Mac-mini run.
