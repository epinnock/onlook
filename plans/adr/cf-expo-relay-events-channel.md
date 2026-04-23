# ADR: cf-expo-relay `/events` endpoint — poll-based phone→editor event channel

**Status:** Proposed
**Date:** 2026-04-22
**Decider(s):** Claude session 873a2632 (worktree `.trees/two-tier-bundle`)
**Related task(s):** #72, #83, #98, #100, #101, #102 from the session task list; MCG.9 / MCG.10 in `plans/onlook-mobile-client-task-queue.md`

## Context

Bridgeless iOS 18.6 does not dispatch `WebSocket.onopen` / `onmessage` events
back to JS (ADR `v2-pipeline-validation-findings.md` finding #8). The
OverlayAck + bundleUpdate + overlayError phone↔editor channel therefore
cannot ride the existing cf-expo-relay `/ws/:sessionId` upgrade. The same
class of bugs affects `fetch()` (finding #2), for which
`OnlookRuntime.httpGet` (synchronous JSI → NSURLSession) is the documented
workaround. This ADR extends that workaround to the event channel via a
poll-based `/events` endpoint.

The JS-side primitive (`startRelayEventPoll`, `startOverlayAckPoll`) +
typed event union (`RelayEventSchema` in
`packages/mobile-client-protocol/src/relay-events.ts`) are shipped. What's
missing is the relay implementation. This ADR freezes the wire contract so
the relay task can proceed without re-litigating shape.

## Decision

Adopt a pull-oriented event channel with a cursor token:

- **Endpoint:** `GET /events?session=<id>&since=<cursor>`
- **Response:** `{ events: TypedRelayEvent[], cursor: string }`
- **Transport:** HTTP/1.1 or HTTP/2; plain JSON response body.
- **Default poll interval:** 1000 ms (client-side default, configurable).
- **Cursor semantics:** monotonic-per-session sequence number, passed
  back verbatim to the relay in the next poll. Clients treat it as
  opaque.
- **Event retention:** relay MUST retain up to 100 events per session for
  at least 10 seconds after creation. Clients that lag beyond this are
  served a `gap` synthetic event (proposed; see "Open questions").
- **Keep-alive:** relay SHOULD emit a `keepAlive` event every 15 seconds
  of idle time so the client's cursor advances even without real traffic.
- **Authentication:** none in v0 (matches the current `/manifest/:sha`
  and `/ws/:sessionId` posture). Moves to signed session tokens when the
  relay adopts cf-zero-trust (tracked separately).

### Event kinds (frozen)

Union declared in `packages/mobile-client-protocol/src/relay-events.ts`:

| `type`           | Direction      | Purpose                                                           |
|------------------|----------------|-------------------------------------------------------------------|
| `overlayAck`     | relay→phone    | Editor received overlay-mount notification from the device.       |
| `bundleUpdate`   | relay→phone    | Editor pushed a new bundle; phone should remount.                 |
| `overlayMounted` | relay→phone    | Editor-originated confirmation that the latest bundle mounted.    |
| `overlayError`   | relay→phone    | Editor-originated mount/runtime error (message + stack).          |
| `keepAlive`      | relay→phone    | Empty heartbeat; advances cursor without real traffic.            |

Every event shape:
```ts
{ id: string;    // unique within (session, cursor window)
  type: string;  // one of the five above
  data: <discriminated payload per type> }
```

See `RelayEventSchema` + `RelayEventsResponseSchema` for the full Zod
definitions. `parseRelayEvent(raw)` returns `{ok:true,event} | {ok:false,error}`
for safe client-side validation that doesn't crash the poll loop.

### Query-param contract

- `session`  (required) — string; matches the sessionId the client sent in
  its manifest + bundle requests. Invalid / unknown sessions MUST return
  `{ events: [], cursor: "" }` rather than 404, so a race between session
  creation and first poll does not surface as an error.
- `since`    (optional) — cursor returned by the previous poll. Omit on
  the first call; the relay returns the earliest retained window.
- `wait`     (optional, reserved) — `long-poll` variant; the relay MAY
  hold the request open until at least one event is available OR a
  deadline (e.g. 20 s) expires. Not implemented in v0; clients always
  use short-poll.

### Response status codes

- `200` — success, body matches `RelayEventsResponseSchema`.
- `400` — malformed query (missing `session=`). Body: JSON `{error:string}`.
- `429` — rate-limited. Body: JSON `{error:string, retryAfterMs:number}`.
  Client honours `retryAfterMs` via ScheduleWakeup-style deferral.
- `5xx` — transient relay error. Client retries on next poll tick.

Everything else surfaces as `onError` in the poll loop.

## Alternatives considered

- **Option A (chosen): HTTP poll via `OnlookRuntime.httpGet` + discriminated
  event union.** Works today on bridgeless+new-arch; piggy-backs the
  already-validated httpGet path; cursor model is cheap for the relay to
  implement on Durable Objects.
- **Option B: Fix WebSocket in bridgeless iOS 18.6.** Rejected — root-cause
  is in RN / Hermes / iOS; not fixable at the app layer.
- **Option C: Server-Sent Events (SSE) over httpGet.** Rejected — httpGet
  is synchronous and one-shot, not streaming. Could be bolted onto a
  separate streaming primitive but doubles the JSI binding surface for
  a marginal latency win.
- **Option D: Webhook-to-push from relay to a phone-local HTTP server.**
  Rejected — requires opening a port on the device, which bridgeless iOS
  makes unreliable and App Store review hostile.
- **Option E: Piggyback on `/manifest/:sha` polling already used for bundle
  updates.** Rejected — conflates two channels with different retention
  / ordering / keep-alive needs, and ties event cadence to bundle-publish
  cadence.

## Consequences

Positive:

- Unblocks MCG.10 / task #72: the cf-expo-relay team can implement the
  endpoint against a frozen contract without protocol-level back-and-forth.
- Typed end-to-end: `parseRelayEvent` validates each event against the
  schema; malformed payloads surface as `onError` events rather than
  crashing the poll loop.
- Cursor model composes with rate-limiting and session eviction — both
  can advance the cursor to the current tail without re-sending.

Negative:

- Polling has worst-case 2× interval latency for event delivery. At
  1 s intervals that's ≤ 2 s — acceptable for OverlayAck (editor UI
  latency, not real-time gameplay) but not for future real-time inspector
  streams. Revisit once those land.
- Storage: retaining 100 events × N sessions × 10 s keeps a small amount
  of state on the relay. With DO alarms this is cheap; worth measuring
  once the relay handler lands.
- Long-poll is deferred; every poll incurs a round-trip even when idle.
  `keepAlive` mitigates cursor advancement but not bandwidth.

Neutral:

- The same schema + parser can front a WS-based channel later without
  client changes — `startRelayEventPoll` is dispatch-agnostic.

## Open questions

- **Gap detection.** If the client polls after its oldest event expired
  on the relay, how should the relay surface that? Proposal: emit a
  synthetic `gap` event with the client's last-seen cursor vs. current
  tail, so the client can re-fetch manifest + remount. Not in the v0
  union; add once the retention window is instrumented.
- **Multi-device sessions.** The current `session=` is a single-device
  identifier; a future multi-device editor preview would either need a
  per-device event stream or a `device=` sub-selector. Out of scope for
  MCG.10.
- **Binary payloads.** The `data` field is JSON today. If a future event
  carries binary (e.g. redux state snapshot), we base64-encode in `data`
  or add a parallel `/events/:id/blob` endpoint. Deferred.
- **Ordering guarantees.** Events within one response are ordered
  oldest-first. Across responses, the client's cursor ensures no
  duplicates, but a client that retries mid-request could observe the
  same event twice — the JS primitive's `seen` Set handles this today.

## References

- `packages/mobile-client-protocol/src/relay-events.ts` — Zod schemas +
  `parseRelayEvent` helper (ships 18 unit tests).
- `packages/mobile-preview/runtime/src/relayEventPoll.ts` — the JS poll
  primitive (13 unit tests).
- `apps/mobile-client/src/relay/overlayAckPoll.ts` — mobile-client wrapper
  over the primitive + `twoTierBootstrap` hook (12 + 4 unit tests).
- `plans/adr/v2-pipeline-validation-findings.md` — finding #8 (WS broken
  on bridgeless iOS 18.6).
- `plans/adr/overlay-abi-v1.md` — the ABI this channel is built against.
- `plans/adr/two-tier-protocol-channels.md` — the wider channel map.
