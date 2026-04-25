# cf-expo-relay

Cloudflare Worker + Durable Objects that relay JS bundles, overlay updates,
and phone→editor events between the editor browser tab and the Onlook
Mobile Client / Expo Go.

## Routes

| Method | Path                       | Purpose                                                               |
|--------|----------------------------|-----------------------------------------------------------------------|
| GET    | `/manifest/:bundleHash`    | Two-tier manifest (64-hex hash path). Proxies `manifest-fields.json` + `meta.json` from cf-esm-cache and folds them into an Expo Updates v2 manifest. |
| GET    | `/:bundleHash.ios.bundle`  | Proxies the Hermes bundle from cf-esm-cache via service binding or direct HTTP fallback. |
| GET    | `/base-bundle[/...]`       | Reserved for the two-tier base-bundle artifact set (R2-backed). 501 stub until R2 wiring lands. |
| WS     | `/hmr/:sessionId`          | Two-tier overlay channel. Editor pushes `overlayUpdate`; phone ↔ editor observability (`onlook:console`, `onlook:overlayAck`, etc.) fans out. |
| POST   | `/push/:sessionId`         | Editor→relay overlay publish over HTTP (paired with `/hmr/:sessionId` WS). |
| GET    | `/events?session=<id>&since=<cursor>` | **Poll channel for events the phone can't receive via WS** on bridgeless iOS 18.6 (see ADR `v2-pipeline-validation-findings.md` finding #8). Returns `{events, cursor}` JSON. |
| POST   | `/events/push?session=<id>` | Publish an event into the poll channel. Forwards to the per-session `EventsSession` DurableObject. |
| GET    | `/session/:id/manifest`    | Legacy single-bundle path (`ExpoSession`). Preserved behind feature flag. |
| GET    | `/session/:id/bundle.js`   | Legacy single-bundle path. |
| WS     | `/session/:id`             | Legacy single-bundle WS. |

## Flow — two-tier overlay (v2)

1. Editor bundles the overlay via `@onlook/browser-bundler` → wraps with
   `wrapOverlayV1` → POSTs to `/push/:sessionId` as an `overlayUpdate`.
2. `HmrSession` DO validates against `OverlayUpdateMessageSchema`, persists
   the latest payload under `last-overlay-v1`, and fans out to every
   connected phone + editor WebSocket on `/hmr/:sessionId`.
3. Mobile-client receives the `overlayUpdate` via `OverlayDispatcher`,
   evaluates it through `OnlookRuntime.mountOverlay`, renders.
4. Mobile-client emits `onlook:overlayAck` back through the same `/hmr`
   socket (phone→editor WS send works on bridgeless iOS; only receive-
   side event dispatch is broken).
5. Editor's `RelayWsClient` ingests the ack via `subscribeRelayEvents` and
   buffers it for the dev panel's `MobileOverlayAckTab` component.

## Flow — `/events` poll channel

Bridgeless iOS 18.6 does not dispatch WS `onmessage` to JS (ADR finding #8),
so events the phone must RECEIVE (editor-originated `bundleUpdate`,
`overlayMounted` confirmations, `keepAlive`) flow over the HTTP `/events`
poll path instead. The wire contract is documented in
`plans/adr/cf-expo-relay-events-channel.md`.

- Phone: `GET /events?session=<id>&since=<cursor>` via
  `OnlookRuntime.httpGet` (synchronous JSI → NSURLSession, which DOES work).
  Implementation at `packages/mobile-preview/runtime/src/relayEventPoll.ts`
  + `apps/mobile-client/src/relay/overlayAckPoll.ts`.
- Editor: `POST /events/push?session=<id>` — publishes a typed event
  matching `RelayEventSchema` in `@onlook/mobile-client-protocol`.
- Per-session `EventsSession` DO keeps a ring buffer (cap 100, 10s TTL)
  + monotonic cursor + 15s keepAlive synthesized on-demand during idle
  polls.

## Bindings

Configured in `wrangler.jsonc`:

- `BUNDLES` — KV namespace for legacy single-bundle payloads.
- `BASE_BUNDLES` — R2 bucket for two-tier base-bundle artifacts.
- `EXPO_SESSION` — Durable Object for legacy single-bundle sessions.
- `HMR_SESSION` — Durable Object for two-tier `/hmr/:sessionId` WS sessions.
- `EVENTS_SESSION` — Durable Object for the poll-channel `/events` queue.
- `ESM_CACHE` — Service binding to the sibling cf-esm-cache worker
  (falls back to HTTP fetch against `ESM_CACHE_URL` when the binding
  isn't present — used by local dev + unit tests).

Create the KV namespace once before the first deploy:

```sh
wrangler kv:namespace create BUNDLES
# replace placeholder-bundles-kv-id in wrangler.jsonc with the returned id
```

Create the R2 bucket once:

```sh
wrangler r2 bucket create expo-base-bundles
```

## Local dev

Fastest path: run the single worker and exercise the routes with curl:

```sh
bun install
bunx wrangler dev
```

For full two-tier validation, run the cf-esm-cache stand-in as a sibling
wrangler dev so the `ESM_CACHE` service binding resolves inside workerd
(workerd's local mode blocks loopback fetches to `127.0.0.1`, so a plain
HTTP server on port 8789 doesn't work — the service binding does):

```sh
# Terminal A — cf-esm-cache stand-in (synthesizes manifest-fields + bundle)
bunx wrangler dev --config scripts/wrangler-local-esm-cache.jsonc \
    --port 18789 --inspector-port 9331 --local

# Terminal B — the real relay
bunx wrangler dev --port 18788 --inspector-port 9330 --local

# Verify
bash scripts/smoke-events.sh http://localhost:18788   # 5 /events assertions
bash scripts/smoke-e2e.sh                             # 11 full-pipeline assertions
```

## Tests

```sh
bun test          # 197 tests across 17 files (covers all route + DO + integration)
bun run typecheck # tsc --noEmit, clean
```

## References

- ADR `plans/adr/overlay-abi-v1.md` — overlay protocol spec
- ADR `plans/adr/v2-pipeline-validation-findings.md` — 8 bridgeless findings that shaped the design
- ADR `plans/adr/cf-expo-relay-events-channel.md` — /events wire contract
- `plans/two-tier-overlay-v2-task-queue.md` — full scope + per-task status
- `plans/implementation-plan-expo-build.md` §3.1 — legacy single-bundle design
