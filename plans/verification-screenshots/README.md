# On-device verification screenshots — PR #12

Captured 2026-04-17 on iOS Simulator (UDID `2C5C7F81-0C5F-4252-9BC5-820159F6764E`) running Expo Go SDK 54 against the merge branch's `packages/mobile-preview/runtime/bundle.js`. Each screenshot is keyed to the commit it proves.

| # | Screenshot | Proves | Related commit |
|---|---|---|---|
| 01 | `01-default-screen.png` | Runtime boots, `shell.js` bootstrap runs on Expo Go (HMRClient + AppRegistry + RCTDeviceEventEmitter registered), default purple screen renders via reconciler + Fabric | `1269f58a` (shell guard) |
| 02 | `02-first-live-push.png` | First successful live push after the Fabric reactTag de-dupe workaround. Solid green + "GREENMARK" — proves subsequent `completeRoot` calls propagate once the root child has a fresh reactTag | `8034e8e9` (keyed-Fragment wrap) |
| 03 | `03-live-edit-1.png` | Red screen + "EDIT_1" — first of 3 consecutive live-edit cycles via direct `/push` | `8034e8e9` |
| 04 | `04-live-edit-2.png` | Blue screen + "EDIT_2" — second cycle | `8034e8e9` |
| 05 | `05-live-edit-3.png` | Orange screen + "EDIT_3" — third cycle. 3 distinct frames prove every push propagates | `8034e8e9` |
| 06 | `06-autokeyed.png` | Purple screen + "AUTOKEYED_PURPLE". Caller did NOT set a key; `renderApp` auto-wraps in keyed Fragment. Proves the auto-key is transparent to user code | `dc3e1d95` (extracted helper + tests) |
| 07 | `07-caller-key.png` | Pink screen + "CALLER_KEY_PINK". Caller provided `key='caller-chose-this-key'`; `wrapForKeyedRender` passes it through unchanged — auto-key doesn't clobber explicit keys | `dc3e1d95` |
| 08 | `08-hooks-working.png` | Dark blue screen + "count=0 renders=1". A HookTest component using `useState + useEffect + useRef` rendered successfully after the React-copy dedupe. Previously threw "Cannot read property 'useState' of null" | `86a9d18b` (react 19.2.0 align) + `0ca077c4` (build-time guard) |
| 09 | `09-loginscreen-with-hooks.png` | "Sign in / Tap to begin / you@example.com" — full AI-generated-style LoginScreen with `useState` for email + focused state. The kind of AI-generated screen that hit `useState of null` for months before the React-copy fix | `86a9d18b` |
| 10 | `10-editor-save-end-to-end.png` | Sea green (`#2E8B57`). User edits `styles.container.backgroundColor` from `#050816` to `#2E8B57` in CodeMirror, clicks Save — ~6s later the sim paints sea green. Confirms editor → mp-server → sim end-to-end through the real wrap-eval-bundle path | `b26ff3a0` (editor push pipeline) + `8034e8e9` + `86a9d18b` |
| 11 | `11-100-push-stress.png` | Gray final frame after 100 consecutive `/push` calls in ~2s. No OOM, sim responsive, all 100 commits logged (`B13 eval OK` x 100 in sim logs) | `dc3e1d95` |

**Full performance envelope** (from the evidence behind these screenshots): push latency ~15–25 ms end-to-end; sustained throughput ~50 pushes/sec; bundle 1054 KB with 48.5% headroom to the 2 MB ceiling.

**Not screenshot-able**: the 3 remaining mobile-client test-harness errors (`DevSettings` / `Alert` / `useMemo` bun-ESM-CJS named-import mismatches) are build-time errors in `bun test`, no UI state to capture.
