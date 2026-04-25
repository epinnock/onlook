# phase-9-51-e2e — browser + sim walkthrough

Verifies the **Phase 9 #51 UI wire-in** (commit `38fd856c`) end-to-end:
dev-login → /projects → editor renders → "Preview on device" → QR modal
→ deep-link → iPhone 16 Pro simulator on the Mac mini farm.

Committed alongside the 10 real bug fixes caught during the walkthrough
itself (see `results.json` → `summary.bugs_fixed_during_verification`).

## Two distinct preview paths in this repo (read first)

The codebase has two separate preview pipelines with two different URL
schemes — easy to confuse, especially because Expo Go is usually
co-installed on the same simulator:

| Path | URL scheme | App handler | Bundle | Documented in |
|---|---|---|---|---|
| Mobile-preview server (Expo Go testing) | `exp://192.168.0.14:8787/manifest/<hash>` | **Expo Go** (NOT OnlookMobileClient) | full-runtime `bundle.js` (~263KB, React + reconciler) | `plans/article-native-preview-from-browser.md` |
| OnlookMobileClient (production) | `onlook://launch?session=<HASH>&relay=<URL>` | `com.onlook.mobile` (custom client) | slim `bundle-client-only.js` (~9KB, native React assumed) | `plans/adr/v2-pipeline-validation-findings.md` + `apps/cf-expo-relay/` |

iOS routes URL schemes by last-installed-claimer. With Expo Go also on
the sim, `exp://` deep-links go to **Expo Go**, not OnlookMobileClient,
even when OnlookMobileClient is the foreground app. To test
OnlookMobileClient specifically, always use the `onlook://` scheme — it
maps cleanly via `parseOnlookDeepLink` in
`apps/mobile-client/src/deepLink/parse.ts`.

### Known compatibility gap on the Expo Go path

Observed during this session: the mobile-preview server's `bundle.js`
blanked when loaded by **Expo Go SDK 54 + new-arch**, with the JS
runtime logging `B13 ERROR: _initReconciler not found — runtime not
loaded?` immediately after `B13 runApplication`.

**Root cause** (PR #20): `packages/mobile-preview/runtime/entry.js`
gated the `require('./runtime.js')` call on `typeof window !==
'undefined'`. The check was added in commit c7b4d21d to keep
`runtime.js` out of the Onlook Mobile Client (Hermes), but Expo Go
is also Hermes — `window` is undefined at prepend time there too —
so `runtime.js` never executed and `_initReconciler` / `renderApp`
were never registered. PR #20 drops the redundant `window` check
and relies solely on `__noOnlookRuntime` (set true by
`apps/mobile-client/index.js`), restoring the contract already
documented in entry.js's own comment.

Until PR #20 lands and the runtime bundle is rebuilt + restaged in
`/tmp/cf-builds/<hash>/`, this verification suite's `_old-05-sim-
mount-broken.png` and `_old-07-sim-post-rls-fix-broken.png` reflect
that broken-gate state. Once #20 ships, Expo Go's preview path
should mount the "Onlook Runtime Ready" default screen on first
manifest fetch.

This is **not** a regression introduced by this PR — it's a pre-
existing architectural gap that explains why the original
`_old-05-sim-mount-broken.png` and `_old-07-sim-post-rls-fix-broken.png`
captures were blank. The fix lives in PR #20; PR #19's correction
of the screenshot interpretation stands either way (the originals
captured Expo Go's failure to mount, not OnlookMobileClient's idle
state).

## Layout

- `reference/` — committed baseline screenshots. Inspect these when you
  want to know "what did the editor look like the last time this suite
  was green."
- `results/` — gitignored output of the latest run. Regenerated in place.
- `results.json` — machine-readable scenario state. Always the source of
  truth.

## Re-running

1. `bun run backend:start` — Supabase local (port 54321).
2. `bun run db:push` — pushes drizzle schema + auto-reapplies RLS
   (commit `efb9286c`).
3. `bun run db:seed` — seeds dev-guest user + demo project.
4. `bun run dev` — Next.js on port 3000.
5. `bun run packages/mobile-preview/server/index.ts` — mobile-preview
   relay (ports 8787 HTTP / 8788 WS), runs bundle-store self-heal
   (commit `9339ac60`).
6. Walk the 9 scenarios in `results.json`. Screenshot each step to
   `results/`. Replace `reference/` only after a known-good run.
7. For the sim step (#05):
   - SSH to `scry-farmer@192.168.0.17` (Mac mini, Xcode 16.4, iOS 18.6 sim).
   - `xcrun simctl openurl 899AA6D2-7A61-4209-98C3-671A6EAE2379 "<exp:// URL from the QR modal>"`
   - Screenshot with `xcrun simctl io 899AA6D2... screenshot /tmp/sim.png`.

## Two scenarios deferred

See `results.json` → `not_yet_verified_in_this_run`:

- **Real overlay render on the sim** — needs cf-expo-relay + cache
  wranglers + a real overlay bundle in cache. Wire is proven green by
  `bash apps/cf-expo-relay/scripts/smoke-e2e.sh` (11/11).
  Visual evidence: `plans/adr/assets/v2-pipeline/v2r-{hello,updated}.png`.
- **Live-edit round-trip** — seed project lacks source files; covered by
  `two-tier-e2e.spec.ts` (3 tests in Node mocks). Populating the
  `expo-projects` bucket with a real Expo seed source tree would
  unblock it; that's a seed-data task, not a code change.

## Known local-dev issues (not fixed — external signal)

- Penpal reconnect still fires 1 timeout on cold boot before cap kicks
  in (commit `a33e0405`). Expected when the preview iframe has no
  rendered content.
- `400 Bad Request` resource loads are esm.sh preflights — Cloudflare-
  external, not actionable from this repo.
- MobX strict-mode warnings (`SessionManager.provider` mutated outside
  action) — pre-existing pattern, not in this session's scope.

## Correction history

The original `05-sim-mount.png` and `07-sim-post-rls-fix.png` were
misinterpreted as "correct idle OverlayHost state." They actually
captured the `exp://` URL being hijacked by Expo Go (also installed on
the sim), with Expo Go failing to mount the mobile-preview server's
full-runtime bundle (incompatible with bridgeless+new-arch). Replaced
with:

- `05-sim-launcher-fresh.png` — proper OnlookMobileClient launcher
  (matches `plans/adr/assets/v2-pipeline/post-g-launcher.png`)
- `07-sim-post-onlook-deeplink.png` — post-deep-link state via
  `onlook://launch?session=<HASH>&relay=<URL>` (the scheme registered
  by OnlookMobileClient itself); the launcher remains visible because
  `qrToMount` correctly fails at the mount stage when pointed at the
  mobile-preview server's full-runtime bundle.

Originals archived as `_old-05-sim-mount-broken.png` and
`_old-07-sim-post-rls-fix-broken.png` for traceability.

The full visual mount + render flow (overlay actually rendering on
the sim) is covered by Phase G's committed evidence in
`plans/adr/assets/v2-pipeline/v2r-{hello,updated}.png`, captured
against the cf-expo-relay path (smoke-e2e.sh 11/11). The mobile-
preview server path tested here is for Expo Go, not OnlookMobileClient.
