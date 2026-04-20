# cf-expo-relay deployment notes

Operational guide for landing the two-tier pipeline changes in production. Covers the Durable Object migration, the push-origin secret, and post-deploy verification.

## What this deploy adds

- **Durable Object:** `HmrSession` — fans out overlay pushes to connected phone clients, persists the last overlay for late-joining clients.
- **Migration v2:** `new_sqlite_classes: ["HmrSession"]` (applied automatically by `wrangler deploy`).
- **HTTP routes:** `POST /push/:sessionId`, `OPTIONS /push/:sessionId`, `WS /hmr/:sessionId`.
- **Secret:** `ALLOWED_PUSH_ORIGINS` (comma-separated editor origins allowed to POST overlays; unset = any origin, for local dev only).

## Pre-deploy checklist

1. `bun test src/__tests__/*.test.ts src/__tests__/routes/*.test.ts` — 112 tests green.
2. `bun run typecheck` — clean.
3. Confirm `wrangler.jsonc` has both bindings + both migrations:

   ```jsonc
   "durable_objects": {
     "bindings": [
       { "name": "EXPO_SESSION", "class_name": "ExpoSession" },
       { "name": "HMR_SESSION",  "class_name": "HmrSession" }
     ]
   },
   "migrations": [
     { "tag": "v1", "new_sqlite_classes": ["ExpoSession"] },
     { "tag": "v2", "new_sqlite_classes": ["HmrSession"] }
   ]
   ```

   Same duplication lives inside `env.production.durable_objects` and `env.production.migrations` — wrangler does NOT inherit those into named environments.

## Deploy

```bash
cd apps/cf-expo-relay
bunx wrangler deploy --env production
```

`wrangler deploy` applies migration v2 automatically. No manual steps.

## Set the push-origin allowlist

```bash
# Replace the URL with whatever production editor origin(s) ship.
echo 'https://editor.onlook.com,https://app.onlook.com' | \
  bunx wrangler secret put ALLOWED_PUSH_ORIGINS --env production
```

Verify:

```bash
bunx wrangler secret list --env production | grep ALLOWED_PUSH_ORIGINS
```

If unset in production, the relay reflects **any** `Origin` header — safe for dev but not for prod. Set this before enabling the editor's two-tier feature flag.

## Post-deploy smoke

1. OPTIONS preflight from an allowed origin:

   ```bash
   curl -sI -X OPTIONS \
     -H 'Origin: https://editor.onlook.com' \
     https://expo-relay.onlook.workers.dev/push/smoke-1
   # expected: 204 + Access-Control-Allow-Origin: https://editor.onlook.com
   ```

2. POST a dummy overlay:

   ```bash
   curl -s -X POST \
     -H 'Content-Type: application/json' \
     -H 'Origin: https://editor.onlook.com' \
     --data '{"type":"overlay","code":"console.log(1);"}' \
     https://expo-relay.onlook.workers.dev/push/smoke-1
   # expected: 202 {"delivered":0}   (0 because no WS clients are connected)
   ```

3. WebSocket upgrade:

   ```bash
   bunx wscat -c 'wss://expo-relay.onlook.workers.dev/hmr/smoke-1'
   # expected: `connected` — and an immediate replay frame of the overlay
   #           we pushed in step 2.
   ```

4. Tail logs to confirm the structured fan-out event fires:

   ```bash
   bunx wrangler tail --env production | grep '"event":"hmr.push"'
   # expected on each /push: {"event":"hmr.push","delivered":N,"bytes":…,"sockets":…}
   ```

## Rollback

If the two-tier channel misbehaves in prod:

1. Deploy the previous worker version (no new migrations needed — HmrSession DO class stays declared):

   ```bash
   git checkout <pre-two-tier-tag>
   bunx wrangler deploy --env production
   ```

2. The editor's `NEXT_PUBLIC_MOBILE_PREVIEW_PIPELINE` defaults to `shim`, so as long as you don't flip it to `two-tier` (or unset it on the editor build), no client traffic exercises the new routes even if the DO is still declared.

3. To fully remove the HmrSession DO (last resort — takes manual CF Dashboard work), delete the binding under "Durable Objects" in the Workers dashboard. Wrangler's CLI does not expose this destructively.

## Known gotchas

- **Body size cap.** POST /push is capped at 2 MiB. Overlays above that bounce with 413; tune `MAX_OVERLAY_BODY_BYTES` in `src/do/hmr-session.ts` if a legitimate overlay ever approaches the cap.
- **Content-Type required.** Non-`application/json` bodies bounce with 415. The editor push client always sends the correct header; this mostly prevents confused clients from silently dropping into the body path.
- **Late-join replay.** HmrSession persists the last overlay under `last-overlay` in DO storage. If you want a "cold session" to NOT replay the last overlay (e.g. after rotating deployments), purge via the CF Dashboard DO inspector or a one-off `wrangler durable-objects` command.
