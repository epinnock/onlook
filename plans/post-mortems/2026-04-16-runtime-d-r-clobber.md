# Runtime __d/__r clobber — post-mortem

Date: 2026-04-16
Severity: P1 (blocked first device boot)
Resolved by: commit 40e0f2ec + regression test bbd641c6
Author: Onlook team + Claude (orchestrator)

## Summary

During the first physical iPhone boot of the mobile-client, the app installed and launched but immediately threw a Hermes red-box: "runtime not ready: Cannot convert null value to object". Root cause was top-level `__d`/`__r` declarations in our preview runtime hoisting to global scope and clobbering Metro's native module system in the composed Hermes bundle. User impact: first device boot blocked for roughly 30 minutes. Fix shipped in commit 40e0f2ec (IIFE wrap) with regression test bbd641c6 added minutes later.

## Timeline

- 10:39 — First xcodebuild launched on Mac mini (failed: errSecInternalComponent)
- 10:45 — Keychain unlocked, build re-run succeeded; app installed
- 10:50 — First tap on iPhone icon: app shown, then "runtime not ready: Cannot convert null value to object" red box
- ~11:00 — Root cause identified: top-level `__d`/`__r` declarations in `packages/mobile-preview/server/build-runtime.ts` hoisting to global scope, clobbering Hermes's native Metro module system
- 11:05 — Fix shipped: wrap in IIFE (commit 40e0f2ec)
- 11:15 — Regression test added (commit bbd641c6)
- 11:25 — Rebuilt runtime + app, reinstalled, relaunched — initial bootstrap success
- 11:30 — New bug surfaced: dual-React hooks failure (separate post-mortem to follow once fixed)

## Root cause

Technical description:
- `packages/mobile-preview/server/build-runtime.ts` wraps the Bun-bundled runtime with a preamble that declares `var __modules`, `function __d`, `function __r` at top-level.
- When `HermesBootstrap.swift` composes the combined bundle by prepending `onlook-runtime.js` onto `main.jsbundle`, these top-level function declarations hoist to global scope.
- Hermes loads the combined bundle as one script; the `var/function` declarations at the top of the file take effect before any module execution.
- The runtime's `__r` calls factory with `null` as the last argument (the dependencyMap), because its own module graph has no deps. But Metro-generated `main.jsbundle` modules expect `d` (the dependency map) to be the array they passed to `__d`. When they call `r(d[0])` inside a factory body, they read `null[0]` → "Cannot convert null value to object".

## Why existing tests didn't catch it

- The runtime was tested in isolation (Spike B browser preview), where its `__d`/`__r` were the only module system.
- The composed combined bundle was never evaluated in Hermes before this session's live-device deploy.
- CI builds simulator-only, where the Metro-dev-server bundle path is used (no combined prepend).
- No integration test ran the prepended bundle through a real JS engine.

## Fix

Wrap the module-system glue in an IIFE so its symbols stay block-scoped. See commit 40e0f2ec. Regression test at `packages/mobile-preview/server/__tests__/build-runtime.regression.test.ts`.

## Prevention

1. **Regression guard shipped:** the new test asserts `bundle.js` opens with `(function(){` just before `var __modules` and closes with `})();`.
2. **Integration test needed (not yet done):** a test that runs the composed combined bundle through a JS engine and asserts RN InitializeCore can complete. Tracked as a follow-up.
3. **Documentation:** memory file `project_mobile_client_orchestration.md` now has the "iPhone validation chain" sub-section documenting this class of bug so future contributors know to validate composed bundles.

## Lessons

1. **Browser vs Hermes JS differs in subtle ways.** Our Spike B runtime was a browser-target bundle; assuming it would compose cleanly with Metro-produced Hermes bundles was wishful thinking. Any shared-ish code needs a cross-engine test.
2. **Hoisted declarations are silent contract violations.** Wrapping in an IIFE is cheap — when in doubt, scope.
3. **First live-device deploys surface classes of bugs that CI doesn't.** The "MCI.5 physical-iPhone DoD walk" is not a formality; it's the authoritative integration test.

## Related artifacts

- Commit 40e0f2ec: the fix
- Commit bbd641c6: the regression test
- Memory sub-section: `### iPhone validation chain — dyld / SIGKILL / dual-React sequence`
