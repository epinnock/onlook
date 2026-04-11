# cf-expo-relay

Cloudflare Worker + Durable Object that relays JS bundles between the editor
browser tab and Expo Go running on a user's phone.

## Flow

1. The editor browser tab opens a WebSocket to `wss://<host>/session/:id`.
2. The DO accepts the socket and stores any pushed
   `{ type: 'bundle', sessionId, bundle }` messages into KV under
   `bundle:<sessionId>` (1h TTL).
3. Expo Go fetches `GET /session/:id/manifest` (a small JSON manifest pointing
   at `bundle.js`) and then `GET /session/:id/bundle.js` to load the latest
   bundle from KV.

See `plans/implementation-plan-expo-build.md` §3.1 for the source design.

## KV namespace

The `BUNDLES` KV namespace is **not** auto-created. Before deploying, run:

```sh
wrangler kv:namespace create BUNDLES
```

and replace the `placeholder-bundles-kv-id` value in `wrangler.jsonc` with the
returned id.

## Local dev

```sh
bun install
bunx wrangler dev
```
