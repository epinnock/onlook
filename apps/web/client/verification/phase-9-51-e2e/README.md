# phase-9-51-e2e — browser + sim walkthrough

Verifies the **Phase 9 #51 UI wire-in** (commit `38fd856c`) end-to-end:
dev-login → /projects → editor renders → "Preview on device" → QR modal →
`exp://` deep-link → iPhone 16 Pro simulator on the Mac mini farm mounts
OnlookMobileClient.

Committed alongside the 10 real bug fixes caught during the walkthrough
itself (see `results.json` → `summary.bugs_fixed_during_verification`).

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
