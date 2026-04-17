# PR #12 — reviewer's one-pager

**What this PR is:** a consolidated merge of PRs #11 (`feat/mobile-preview-shim`) + #10 (`feat/mobile-client`), plus the follow-on fixes needed to make the merged code actually work end-to-end on an iOS Simulator running Expo Go SDK 54. Start here if you've just been asked to review #12 and want the gist before diving into 13 commits.

## Scope in one paragraph

#11 shipped the browser-preview runtime, the mobile-preview server, the eval-push pipeline, and a refactored `shell.js`. #10 shipped the custom Onlook Mobile Client scaffold (Swift + C++ JSI installers for `globalThis.OnlookRuntime` / `OnlookInspector`). Merging them cleanly required resolving overlap in `packages/mobile-preview/runtime/shell.js`, `packages/mobile-preview/server/build-runtime.ts`, and `packages/browser-metro/src/host/index.ts`, fixing 305 typecheck errors (no `any`), and fixing 12 unit test regressions. Four additional architectural fixes (shell guard, Fabric reactTag dedupe, React dispatcher linkage, 2 MB size ceiling) and four docs (ADR, baseline, post-mortem, release notes) landed on top so the merged branch validates on-device end-to-end.

## Performance envelope (measured on iOS Sim + Expo Go SDK 54)

- **Push latency** (POST `/push` → first Fabric commit on device): **~15–25 ms** end-to-end, ~0.6 ms HTTP round-trip.
- **Sustained throughput**: **~50 pushes/sec** for 100 consecutive pushes, no OOM, sim responsive through the whole run.
- **Bundle size**: **1054 KB** of a 2 MB ceiling (48.5% headroom, enforced at build time — see `chore(mobile-preview): enforce 2MB bundle-size ceiling`).
- **Hook lifecycle**: `useState + useEffect + useRef` all fire through the eval-push pipeline; `HOOKS: effect count=N → N+1` logs confirm setState-triggered re-renders commit on every frame.

## Commit-by-commit — what and why

Ordered top-down (oldest → newest). Each row: commit sha, one-sentence reason, file anchor.

| sha | Why it existed | Anchor |
|---|---|---|
| `ac972f9b` | Raw merge of #10 into #11 | `packages/mobile-preview/runtime/shell.js`, `packages/browser-metro/src/host/index.ts`, `packages/mobile-preview/server/build-runtime.ts` |
| `fb7100ec` | 305 typecheck errors + 12 test regressions from the merge | `packages/code-provider/src/providers/{cloudflare,codesandbox}/`, `apps/web/client/src/services/mobile-preview/__tests__/react-native-shim.test.ts`, others |
| `1269f58a` | `#10`'s `typeof window !== 'undefined'` gate skipped shell bootstrap on Expo Go (Hermes), so HMRClient never registered and the native side threw into an empty callable-module registry | `packages/mobile-preview/runtime/shell.js` — now gates on `globalThis.OnlookRuntime` presence instead |
| `8034e8e9` + `dc3e1d95` | After the shell fix, Fabric on SDK 54 de-duped `fab.completeRoot` when the root child's reactTag didn't change — second push onward became no-ops | `packages/mobile-preview/runtime/wrap-for-keyed-render.js` (new helper + 4 unit tests) |
| `21debfca` | ADR + baseline docs pinning the Fabric keyed-render decision and the test/validation state of the merge branch | `plans/adr/B13-fabric-reactTag-dedupe-keyed-render.md`, `plans/merge-validation-baseline.md` |
| `86a9d18b` + `0ca077c4` | `packages/mobile-preview` pinned react 19.1.0 while root used 19.2.0 → two React copies in the bundle → user `useState` read `ReactSharedInternals.H` from a different instance than the reconciler wrote to → all hook-using components threw `Cannot read property 'useState' of null` | `packages/mobile-preview/package.json` (version align) + `packages/mobile-preview/server/build-runtime.ts` (build-time guardrail) |
| `79998e4b` | Record the post-dedupe bundle-size in the `minify: false` comment | same file |
| `849e380c` | Pin the wrap-eval-bundle's `useState/useEffect/useRef` payload shape at build time | `apps/web/client/src/services/mobile-preview/__tests__/index.test.ts` |
| `c5511ceb` | User-facing release notes for the maintainer to lift into an announcement | `plans/merge-release-notes.md` |
| `78929d29` | MC1.4.1 housekeeping — rename `[SPIKE_B]` log prefix (spike-era name) to `[onlook-runtime]` across 13 files | `packages/mobile-preview/runtime/bootstrap/logging.js` + 12 companion edits |
| `259a4906` | MC1.9 — flip `SUPPORTED_MODULES.md` task queue status to shipped (doc was already written, queue was stale) | `plans/onlook-mobile-client-task-queue.md` |
| `13badf60` | Companion to the React-copy guardrail: fail the build if `bundle.js` exceeds 2 MB | `packages/mobile-preview/server/build-runtime.ts` |
| `26a3444c` | This file (reviewer one-pager) | `plans/merge-summary-for-review.md` |
| `9ce2e756` | MC1.4.1 residuals — `shell.js` header comment, `fabric.js` error string, `bundle-execution.test.ts` description | various |
| `2a3d1190` | Rewrite 5 stale tests in `bundle-execution.test.ts` to match the current OnlookRuntime-gated architecture (was 13 pass/5 fail → now 18 pass/0 fail) | `packages/mobile-preview/server/__tests__/bundle-execution.test.ts` |
| `f986aba7` | Absorb `c8e3e13b` from `feat/mobile-client` (dev-only Screens gallery) so "merge both PRs" stays faithful to the latest state of #10 | `apps/mobile-client/src/{navigation/AppRouter,navigation/NavigationContext,screens/ScreensGalleryScreen,screens/SettingsScreen,screens/index}.tsx` |

## Five-minute local verification

From the repo root, on a clone that tracks this PR:

```bash
# 1. bootstrap
bun install

# 2. typecheck (expect 0 errors)
bun run typecheck

# 3. key test suites (expect all green)
bun test packages/mobile-preview/runtime/__tests__/ \
         packages/browser-metro \
         apps/web/client/src/services/mobile-preview/__tests__/

# 4. runtime build (expect "Size OK: 1054.4 KB of 2048 KB ceiling")
bun run packages/mobile-preview/server/build-runtime.ts

# 5. (optional) live push to sim — requires Expo Go on an iOS Simulator
# Start mp-server + Next.js in separate terminals, then:
#   curl -s http://127.0.0.1:8787/status | jq -r .manifestUrl \
#     | xargs xcrun simctl openurl <udid>
# Wait 10s, then push a test eval:
curl -X POST http://127.0.0.1:8787/push -H 'content-type: application/json' \
  -d '{"type":"eval","code":"var R=globalThis.React;globalThis.renderApp(R.createElement(\"View\",{style:{flex:1,backgroundColor:0xFF00AA00|0}}))"}'
# Sim paints solid green.
```

## Companion plan docs — read these for the long form

- `plans/adr/B13-fabric-reactTag-dedupe-keyed-render.md` — architecture decision for the Fragment-wrap fix, with the FAB_API probe trace and the three alternatives that were considered and rejected.
- `plans/post-mortems/2026-04-17-two-react-copies-hooks-null.md` — five-step diagnosis of the workspace-hoisting React split that caused months of "useState of null" errors in AI-generated screens.
- `plans/merge-validation-baseline.md` — authoritative record of typecheck + unit-test + on-device state of the merge branch, plus the three pre-existing infra-dependent failure clusters classified (not regressions).
- `plans/merge-release-notes.md` — 6-bullet user-facing summary suitable for a release announcement.

## Known out-of-scope

This PR does **not** include:

- Android toolchain work — MC1.5–1.7, MC2.4, MC2.6, MC4.7–4.11 (native Android bridge + OnlookInspector port). All gated on an Android dev environment not available in the session that produced the merge.
- Most iOS native work beyond `ac972f9b`'s base scaffold — the Swift + C++ pieces were already in `feat/mobile-client` before the merge.
- Chrome MCP end-to-end scenarios under `apps/web/client/verification/onlook-editor/scenarios/08-*` through `14-*` — those are Phase H / Q work on `feat/expo-browser-provider`.
- The 68 pre-existing infra-dependent test failures (CF Worker endpoints, CF Sandbox full-flow, binary-size-audit) — classified in the baseline doc; each needs a specific external service or build artifact.

## If you accept

Merging this PR to `origin/main` is a fast-forward (branch is 0 behind origin/main). No conflicts, no rebase required. PRs #10 and #11 remain open and cross-linked to #12; the maintainer can close them whenever.

## If you reject

The most likely concerns are (a) scope — this PR bundles six fixes on top of the raw merge, and a reviewer might prefer them split into separate PRs. If so, the commit structure is already independent: each fix + its test + its doc is a contiguous commit group, cleanly revertable. (b) The three build-time guardrails (React-copy, 2 MB ceiling, ESM-leak) could be relaxed to warnings. All three were written after real failures, so the sharp-edge behavior is deliberate — but that's a judgment call.
