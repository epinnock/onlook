# Mobile Client Validate Script Index

Bespoke per-task validators that substitute for Maestro flows currently hanging on the bare RN scaffold. Each builds+installs the app on the booted iOS Simulator and scrapes `xcrun simctl spawn booted log stream` for the expected runtime log line.

| Script | Task ID | What it validates | Expected outcome | Dependencies |
| ------ | ------- | ----------------- | ---------------- | ------------ |
| `validate-mc14.sh` | MC1.4 | HermesBootstrap iOS path: `onlook-runtime` evaluates into Hermes before the user bundle | Device log captures `[onlook-runtime] hermes ready` within ~6s of launch; script exits 0 | macOS + Xcode, booted iOS Simulator, `bun run mobile:build:ios`, `xcrun simctl`, baked `main.jsbundle` + `onlook-runtime.js` via `run-build.ts` |
| `validate-mc23.sh` | MC2.3 | `OnlookRuntimeInstaller` TurboModule registers `globalThis.OnlookRuntime` via native C++ `install()` | Device log captures `[onlook-runtime] OnlookRuntime installed on globalThis` within ~8s of launch; script exits 0 | macOS + Xcode, booted iOS Simulator, `bun run build:mobile-runtime` (picks up shell.js `__turboModuleProxy('OnlookRuntimeInstaller').install()`), `bun run mobile:build:ios`, `xcrun simctl` |

## Notes

- Both scripts exist because the corresponding Maestro flows (`03-hermes-eval.yaml`, `04-global-present.yaml`) hang on `waitForAnimationToEnd` — the bare RN scaffold from `apps/mobile-client/index.js` + `App.tsx` renders nothing visible.
- The device-log scrape fully covers each task's functional goal without depending on rendered UI.
- Each script prints a small excerpt of the captured log on exit (success or failure).
