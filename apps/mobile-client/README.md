# Onlook Mobile Client

Onlook Mobile Client is a purpose-built iOS/Android client that replaces stock Expo Go in the Onlook preview pipeline. It consumes `cf-expo-relay` bundles via a documented `OnlookRuntime` JSI binding instead of the earlier Spike B scraping path, giving us first-class control over bundle loading, inspector hooks, and observability on the device.

## Quick start

```bash
git clone git@github.com:onlook-dev/onlook.git
cd onlook
bun install
bun run mobile:build:ios
```

The `mobile:build:ios` script drives a local simulator build through `scripts/run-build.ts`. It requires **macOS with Xcode** (and a booted iOS Simulator) — Linux and Windows hosts cannot run it. For Android, use `bun run mobile:build:play-internal` on any host with the Android SDK installed.

## Workspace layout

```
apps/mobile-client/
├── src/         # React Native app source (App.tsx, screens, relay, inspector, storage)
├── cpp/         # C++/Obj-C++ JSI sources for OnlookRuntime + OnlookInspector bindings
├── ios/         # Xcode project, Podfile, and native iOS host (OnlookMobileClient.xcworkspace)
├── e2e/         # Maestro flows and maestro.config.yaml for device/simulator E2E
├── scripts/     # Build, bundle, validate, and task-runner scripts (TypeScript + bash)
└── docs/        # Per-task operator docs (TestFlight, Play Store release notes, etc.)
```

## Validate scripts

Bespoke per-task validators live in `scripts/` and substitute for Maestro flows that currently hang on the bare RN scaffold. Each scrapes the iOS Simulator device log for the expected runtime log line after a fresh build+install. See [`scripts/validate-index.md`](./scripts/validate-index.md) for the full index.

| Script | Tests |
| ------ | ----- |
| `scripts/validate-mc14.sh` | MC1.4 — `onlook-runtime` evaluates into Hermes before the user bundle and emits `[onlook-runtime] hermes ready`. |
| `scripts/validate-mc23.sh` | MC2.3 — the `OnlookRuntimeInstaller` TurboModule runs, `globalThis.OnlookRuntime` is installed, and the C++ confirmation log fires. |

## Cross-references

- [`plans/onlook-mobile-client-plan.md`](../../plans/onlook-mobile-client-plan.md) — full implementation plan and wave breakdown.
- [`plans/onlook-mobile-client-handoff.md`](../../plans/onlook-mobile-client-handoff.md) — engineering handoff notes and conventions.
- [`plans/release-checklist.md`](../../plans/release-checklist.md) — TestFlight / Play Store release gates.
- [`SUPPORTED_MODULES.md`](./SUPPORTED_MODULES.md) — native module whitelist surfaced through the relay.
- [`cpp/README.md`](./cpp/README.md) — layout and build notes for the JSI/C++ sources.

## Current status

Wave 2 (OnlookRuntime JSI binding) is functionally complete on iOS as of **2026-04-16**. See [`plans/wave-progress.md`](../../plans/wave-progress.md) for the live state and the next wave's entry criteria.
