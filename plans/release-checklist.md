# Mobile Client Release Checklist

This checklist gates every shipped build of `@onlook/mobile-client` (iOS TestFlight,
Android Play Store internal track, or any signed artifact distributed to testers).
Walk through it top-to-bottom on the release candidate commit **before** tagging or
uploading. Every box must be checked (or explicitly waived in the release notes with a
reason) before the build goes out. Use it as the PR description template for the
release PR against `main` and paste the completed checklist into the release Git tag
annotation.

When to use:

- Cutting a new TestFlight build (internal or external tester group).
- Promoting a build to Play Store internal track.
- Any hotfix that touches native code, the JSI runtime, or the relay protocol.

Skip only the sections that demonstrably don't apply (e.g., docs-only hotfix can skip
native build verification) and note the skip in the release notes.

---

## 1. Pre-release smoke

- [ ] All shipped `validate-mc*.sh` scripts pass on the Mac mini release runner
- [ ] `bun --filter @onlook/mobile-client typecheck` exits 0
- [ ] `bun --filter @onlook/mobile-client-protocol typecheck` exits 0
- [ ] `bun test` green across all mobile-client workspaces
- [ ] `apps/mobile-client/verification/results.json` reflects all intended tasks as passed (no stale `pending` / `failed` entries for shipped MC IDs)

## 2. Version alignment

- [ ] `ONLOOK_RUNTIME_VERSION` in `@onlook/mobile-client-protocol` matches the intended release number
- [ ] `apps/mobile-client/app.config.ts` `version` field matches the release number (MC6.1)
- [ ] `OnlookRuntime.version` (C++ constant wired via MC2.12) matches the release number
- [ ] Relay manifest-builder's `extra.expoClient.onlookRuntimeVersion` matches the release number (MC6.2)
- [ ] All four values above agree byte-for-byte (no trailing whitespace / casing drift)

## 3. iOS build

- [ ] `bun run mobile:build:ios` succeeds on a clean checkout
- [ ] `onlook-runtime.js` is present in the produced `.app` bundle
- [ ] `main.jsbundle` is present in the produced `.app` bundle
- [ ] `[onlook-runtime] hermes ready` appears in device log within 2s of launch
- [ ] `globalThis.OnlookRuntime` is defined at runtime (confirms MC2.3 installer ran)
- [ ] App launches on a physical iOS device (not just simulator) without crash

## 4. Maestro / e2e flows

Run against the release-candidate `.app` / `.apk` on the Mac mini device farm. When
Wave 2+ flows are still stabilizing, mark the checkbox as N/A and record the flow
name in the release notes.

- [ ] `00-smoke.yaml` passes
- [ ] `03-hermes-eval.yaml` passes
- [ ] Remaining wave-specific flows pass (list each flow file and result in release notes)

## 5. CI green

- [ ] `.github/workflows/mobile-client.yml` last run on `main` is green
- [ ] All wave CI jobs green (MC1.11 pipeline, MC5.18 debug-surface, and every wave lane downstream)
- [ ] No required checks skipped or manually overridden on the release commit

## 6. Distribution prep

- [ ] EAS / TestFlight config verified against the release build profile (MC6.5)
- [ ] Play Store config verified against the release build profile (MC6.6)
- [ ] TestFlight dry-run upload succeeds in CI (MC6.7)
- [ ] Play Store dry-run upload succeeds in CI (MC6.8)
- [ ] Release notes / "What to test" copy drafted for TestFlight
- [ ] Release notes / changelog drafted for Play Store internal track

## 7. Git hygiene

- [ ] `feat/mobile-client` rebased cleanly on `main` (no merge commits, no conflict markers)
- [ ] All commits signed / authored correctly (no `unknown` authors, no stray co-author lines)
- [ ] No staging leftovers committed (e.g., `apps/mobile-client/verification/results.json` from dev iteration, local `.env*`, editor scratch files)
- [ ] Release tag prepared (`mobile-client@<version>`) and annotated with this checklist

---

## Sign-off

Release manager: ____________________

Date: ____________________

Build number (iOS): ____________________

Version code (Android): ____________________

Notes / waivers: ____________________
