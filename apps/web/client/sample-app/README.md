# Sample app — overlay v1 fixture

A minimal RN component used as the input for end-to-end overlay tests.
Exercises the four feature classes the v2 overlay path needs to round-trip
without a real device:

- **Images** — remote `<Image source={{uri}}>` from `https://onlook.com/favicon.ico`.
- **Clickable buttons** — four `<Pressable>` instances (Increment / Reset / Theme / Cycle).
- **Local state** — three `useState` hooks driving counter, theme, and palette index.
- **Save-to-update** — edits to this file should propagate via the v2 push path
  (`pushOverlayV1` → cf-expo-relay `/push/<sessionId>` → mobile-client
  `OnlookRuntime.mountOverlay`).

## How to use

This file is intentionally outside any package's tsconfig so it doesn't get
type-checked or bundled by accident. Tooling that wants to exercise it should
read `./App.tsx` as plain text and feed it through `wrapOverlayV1` →
`pushOverlayV1` directly. Example one-shot push script lives at
`/tmp/push-sample-overlay.ts` (developer-local; not checked in).

## Verification on a real device

Once Xcode 16.1 unblocks the mobile-client rebuild:

1. Build the mobile-client with this session's commits (deeplink + AbiHello +
   tap-to-source wiring).
2. Stand up `cf-expo-relay` locally (`bunx wrangler dev --port 18788 --local`).
3. Bundle this `App.tsx` via `wrapOverlayV1` and POST it to `/push/<sessionId>`.
4. Open `onlook://launch?session=<sessionId>&relay=http://<lan-ip>:18788`
   on the sim — the deeplink wire-up at `f8d70396` routes it through the URL
   pipeline.
5. Edit `App.tsx`, re-bundle, re-push — the v2 overlay live-update path
   (commits `c191fc0d` + Phase 11b safety chain) should mount the new code
   without restart.
