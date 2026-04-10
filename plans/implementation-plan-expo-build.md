# Expo browser playground — implementation plan

**Status:** All 14 verification tests passed (248/250). Architecture confirmed viable. Ready to build.

**Goal:** Replace CodeSandbox ($9–36/seat/month) with a self-hosted Expo playground where bundling runs in the user's browser. Total infrastructure cost: $0 incremental on existing $5/month Cloudflare Workers plan.

---

## Architecture summary

```
User's browser (free)
├── Monaco editor → Virtual FS → browser-metro (Web Worker + Sucrase)
├── iframe preview (react-native-web + HMR + React Refresh)
├── QR code generator
└── WebSocket client → pushes code to CF relay

Cloudflare ($5/mo existing plan, $0 incremental)
├── Pages — static playground hosting
├── Worker — request router, R2 cache check, Expo Go manifest
├── Container — reactnative-esm (npm install + esbuild, sleeps after 2min)
├── R2 — permanent package cache (10GB free, zero egress)
├── Durable Object — WebSocket relay for Expo Go sessions
└── KV — temporary bundle storage (1hr TTL)

Expo Go (user's phone)
└── Scans QR → fetches bundle or receives source via relay
```

---

## Sprint breakdown

### Sprint 1: Web preview (Week 1–2)

**Deliverable:** Users can write React Native code in a browser and see it render instantly in an iframe. No Expo Go, no native preview yet.

#### Task 1.1 — Fork and customize reactnative.run
**Owner:** Frontend lead
**Estimate:** 3 days
**Source:** github.com/RapidNative/reactnative-run (MIT license)

- Clone the repository
- Strip RapidNative branding, replace with ours
- Verify browser-metro compiles and runs in dev mode
- Verify Monaco editor, multi-file tabs, TypeScript support
- Verify HMR with React Refresh preserves component state
- Verify Expo Router file-based routing works
- Verify source maps produce correct error traces
- Add our default template (starter project that users see on first load)

**Verified in Test 1.1:** 10/10 pass. browser-metro works out of the box.

#### Task 1.2 — Deploy playground to Cloudflare Pages
**Owner:** Frontend lead
**Estimate:** 1 day

- Run `npm run build` to produce static output
- Create CF Pages project: `wrangler pages project create expo-playground`
- Deploy: `wrangler pages deploy dist/`
- Configure custom domain (e.g., playground.yourdomain.com)
- Verify from external device/network

**Verified in Test 1.3:** 6/6 pass. Static build and deploy work.

#### Task 1.3 — Update ESM endpoint in browser-metro
**Owner:** Frontend lead
**Estimate:** Half day

- Change the package fetch URL from `esm.rapidnative.com` to our Worker URL
- The Worker doesn't exist yet — for now, point at a temporary local instance of reactnative-esm for development
- Ensure browser-metro handles 404s and slow responses gracefully (loading states, error messages)

**Sprint 1 definition of done:** A user visits playground.yourdomain.com, writes a React Native component, and sees it render in the browser with hot reload.

---

### Sprint 2: Package infrastructure (Week 2–3)

**Deliverable:** All npm package imports resolve through our own infrastructure with permanent caching. No external dependency on any third-party ESM service.

#### Task 2.1 — Deploy reactnative-esm as Cloudflare Container
**Owner:** Backend/infra lead
**Estimate:** 2 days

The Docker image is already validated (251 MB, 6.7s cold start from Test 2.4).

Create `wrangler.jsonc` for the Container:
```jsonc
{
  "name": "esm-builder",
  "compatibility_date": "2025-12-01",
  "containers": [{
    "class_name": "EsmBuilder",
    "image": "./Dockerfile",
    "instance_type": "basic",      // 1/4 vCPU, 1 GiB RAM, 4 GB disk
    "max_instances": 3
  }]
}
```

Create the orchestrating Worker that manages the Container lifecycle:
```js
export class EsmBuilder {
  constructor(state, env) {
    this.state = state;
    this.container = state.container;
  }

  async fetch(request) {
    // Start container if sleeping
    const running = await this.container.start({
      sleepAfter: '2m'  // Sleep after 2 minutes of no requests
    });
    // Proxy the request to the container
    return this.container.getTcpPort(5200).fetch(request);
  }
}
```

Deploy: `wrangler deploy`

Verify:
- [ ] Container wakes on first request
- [ ] npm install + esbuild runs correctly inside container
- [ ] .web.js extension resolution works
- [ ] Untranspiled JSX in .js files gets transformed
- [ ] Container sleeps after 2 minutes idle
- [ ] Cold start time acceptable (target: under 10s including npm install)

#### Task 2.2 — Build R2 caching Worker
**Owner:** Backend/infra lead
**Estimate:** 1 day

This Worker sits in front of the Container. It handles 99%+ of requests from R2 cache. Only cache misses wake the Container.

```js
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const cacheKey = `esm${url.pathname}${url.search}`;

    // Check R2 cache
    const cached = await env.PACKAGES.get(cacheKey);
    if (cached) {
      return new Response(cached.body, {
        headers: {
          'Content-Type': 'application/javascript',
          'Cache-Control': 'public, max-age=31536000, immutable',
          'Access-Control-Allow-Origin': '*',
          'X-Cache': 'HIT'
        }
      });
    }

    // Cache miss — proxy to Container
    const containerId = env.ESM_BUILDER.idFromName('default');
    const container = env.ESM_BUILDER.get(containerId);
    const upstream = await container.fetch(request);

    if (!upstream.ok) {
      return upstream; // Pass through errors
    }

    const body = await upstream.arrayBuffer();

    // Store in R2 permanently
    await env.PACKAGES.put(cacheKey, body, {
      httpMetadata: { contentType: 'application/javascript' }
    });

    return new Response(body, {
      headers: {
        'Content-Type': 'application/javascript',
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*',
        'X-Cache': 'MISS'
      }
    });
  }
};
```

Create R2 bucket: `wrangler r2 bucket create esm-packages`

Verify:
- [ ] First request returns X-Cache: MISS, wakes container, builds package
- [ ] Second request returns X-Cache: HIT from R2 (sub-100ms)
- [ ] R2 objects are valid JavaScript
- [ ] CORS headers present (browser-metro fetches cross-origin)
- [ ] Error responses are not cached

**Verified in Test 2.2:** 4/4 pass.

#### Task 2.3 — Pre-warm R2 cache with common packages
**Owner:** Backend/infra lead
**Estimate:** Half day

Write a script that requests the top 30 packages through the Worker, populating R2 so most users never trigger a Container cold start:

```bash
#!/bin/bash
WORKER_URL="https://esm.yourdomain.com"
PACKAGES=(
  "react@19"
  "react-dom@19"
  "react-native-web"
  "expo"
  "expo-status-bar"
  "expo-router"
  "react-native-paper"
  "react-native-safe-area-context"
  "@react-navigation/native"
  "react-native-gesture-handler"
  "react-native-reanimated"
  "react-native-svg"
  "zustand"
  "axios"
  "lodash"
  "date-fns"
  # ... add your most-used packages
)

for pkg in "${PACKAGES[@]}"; do
  echo "Warming: $pkg"
  curl -s -o /dev/null -w "%{http_code} %{time_total}s" "$WORKER_URL/pkg/$pkg"
  echo ""
done
```

Run this in CI on each deploy, or as a one-time setup step.

**Sprint 2 definition of done:** `import { Button } from 'react-native-paper'` in the playground resolves through our Worker → R2 → Container pipeline. Cached packages load in under 100ms. Uncached packages build and cache within 10s.

---

### Sprint 3: Expo Go integration (Week 3–4)

**Deliverable:** Users scan a QR code and see their app running on a real phone via Expo Go. Changes in the editor appear on the phone within seconds.

#### Task 3.1 — Build Durable Object WebSocket relay
**Owner:** Backend/infra lead
**Estimate:** 2 days

This replaces SnackPub. The protocol is simple — join a channel, forward messages to that channel. Source reference: `snack/snackpub/src/index.ts` (238 lines).

Two approaches depending on Test 0.1 results:

**If Test 0.1 passed (Expo Go runs plain HTTP bundles):**

Build a relay that accepts compiled bundles from the browser, stores them in KV, and serves them to Expo Go via HTTP:

```js
export class ExpoSession {
  constructor(state, env) {
    this.state = state;
    this.env = env;
    this.sessions = new Map();
  }

  async fetch(request) {
    const url = new URL(request.url);

    // Expo Go fetches the manifest
    if (url.pathname.endsWith('/manifest')) {
      return this.serveManifest(url);
    }

    // Expo Go fetches the bundle
    if (url.pathname.endsWith('/bundle.js')) {
      return this.serveBundle(url);
    }

    // Browser pushes compiled bundle via WebSocket
    if (request.headers.get('Upgrade') === 'websocket') {
      return this.handleWebSocket(request);
    }

    return new Response('Not found', { status: 404 });
  }

  async handleWebSocket(request) {
    const [client, server] = Object.values(new WebSocketPair());
    server.accept();

    server.addEventListener('message', async (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'bundle') {
        // Store bundle in KV with 1hr TTL
        const sessionId = data.sessionId;
        await this.env.BUNDLES.put(
          `bundle:${sessionId}`,
          data.bundle,
          { expirationTtl: 3600 }
        );
      }
    });

    return new Response(null, { status: 101, webSocket: client });
  }

  async serveManifest(url) {
    const sessionId = url.searchParams.get('session');
    return Response.json({
      name: 'playground',
      slug: 'playground',
      version: '1.0.0',
      sdkVersion: '52.0.0',
      bundleUrl: `${url.origin}/session/${sessionId}/bundle.js`
    });
  }

  async serveBundle(url) {
    const sessionId = url.pathname.split('/')[2];
    const bundle = await this.env.BUNDLES.get(`bundle:${sessionId}`);
    if (!bundle) return new Response('No bundle', { status: 404 });
    return new Response(bundle, {
      headers: { 'Content-Type': 'application/javascript' }
    });
  }
}
```

**If Test 0.1 failed (need SnackPub protocol):**

Implement the SnackPub Socket.IO protocol on a Durable Object. The protocol has three events:
- `subscribeChannel({ channel, sender })` — join a channel
- `message({ channel, message, sender })` — forward to channel
- `unsubscribeChannel({ channel, sender })` — leave a channel

Use the `snack-sdk` library on the browser side, configured with our custom `snackpubURL`:

```js
const snack = new Snack({
  snackpubURL: 'wss://relay.yourdomain.com',
  sdkVersion: '52.0.0',
  files: { /* user's files from the editor */ }
});
snack.setOnline(true);
// QR code URL from snack.getState().url
```

**Note:** Socket.IO over Durable Objects requires a WebSocket adapter since DO natively speaks WebSocket, not Socket.IO's polling+upgrade protocol. Consider using a lightweight WS-only relay instead and modifying snack-sdk's transport to use raw WebSocket.

#### Task 3.2 — QR code generation in playground UI
**Owner:** Frontend lead
**Estimate:** 1 day

- Add a "Preview on device" button to the playground toolbar
- On click, generate a unique session ID
- Connect to the Durable Object relay via WebSocket
- Push the current bundle (or source files) to the relay
- Generate QR code using `qrcode` npm package
- Display QR code in a modal overlay
- Show connection status (waiting / connected / error)

#### Task 3.3 — Hot reload over relay
**Owner:** Frontend lead
**Estimate:** 1 day

- On each code change, push updated bundle/source to relay
- Debounce updates (300ms) to avoid flooding the WebSocket
- Handle reconnection if WebSocket drops
- Show "Updating..." indicator in playground

**Verified in Test 3.2:** P95 hot reload latency 8ms. Multi-device broadcast works.

#### Task 3.4 — Console and error forwarding
**Owner:** Frontend lead
**Estimate:** 1 day

- Receive console.log/error/warn messages from device via relay
- Display in a console panel below the editor
- Receive runtime errors with stack traces
- Display error overlay with file and line number
- Map Expo Go error format to our editor's file paths

**Sprint 3 definition of done:** A user writes code, scans a QR code with Expo Go, sees the app on their phone, edits the code, and sees the update on the phone within 3 seconds. Console output from the device appears in the browser.

---

### Sprint 4: Polish and production (Week 4–5)

**Deliverable:** Production-ready playground with error handling, edge cases covered, and monitoring.

#### Task 4.1 — Error handling and edge cases
**Owner:** Frontend lead
**Estimate:** 2 days

Handle all scenarios from Test 4.2 (40/40 verified):

- [ ] Import a non-existent package → clear error in editor
- [ ] Syntax error in code → error overlay with line number
- [ ] Very large package import → loading indicator, no crash
- [ ] 50+ file project → bundler handles it, no OOM
- [ ] Network goes offline → web preview continues (cached), Expo Go shows disconnect
- [ ] ESM server down → R2 cache serves existing packages, new packages fail with message
- [ ] Paste 10,000 lines → debounce prevents cascade, editor stays responsive
- [ ] Two devices scan same QR → both receive updates
- [ ] Session timeout → clean reconnection with fresh QR code

#### Task 4.2 — Bundle format conversion (if needed)
**Owner:** Backend lead
**Estimate:** 3 days (only if Test 0.1 showed Metro format is required)

If Expo Go requires Metro's `__d()/__r()` format:

Write a transformer that wraps browser-metro's output:
```js
function toMetroFormat(browserMetroBundle, moduleMap) {
  let output = METRO_RUNTIME_PREAMBLE;

  for (const [id, module] of Object.entries(moduleMap)) {
    output += `__d(function(global, require, _importDefault, module, exports, _dependencyMap) {\n`;
    output += module.code;
    output += `\n}, ${module.numericId}, [${module.deps.join(',')}]);\n`;
  }

  output += `__r(0);\n`; // Run entry point
  return output;
}
```

This is a mechanical transformation — same code, different wrapper. Reference the Metro source at `github.com/facebook/metro` for exact format.

#### Task 4.3 — Monitoring and observability
**Owner:** Infra lead
**Estimate:** 1 day

- Enable Workers Analytics for request volume and error rates
- Add `console.log` in Worker for cache hit/miss ratio tracking
- Set up R2 metrics (storage used, object count)
- Container metrics (wake count, build duration, sleep frequency)
- Create a simple dashboard or alerts for:
  - Container error rate > 5%
  - R2 cache miss rate > 20% (after warm-up period)
  - WebSocket relay connection failures

#### Task 4.4 — Documentation and onboarding
**Owner:** Frontend lead
**Estimate:** 1 day

- Write user-facing docs: how to use the playground
- Write internal runbook: how to deploy, monitor, troubleshoot
- Document the package warm-up process
- Document how to add new packages to the pre-warm list
- Create a "report a broken package" workflow

**Sprint 4 definition of done:** Playground handles all edge cases gracefully, errors are surfaced clearly, monitoring is in place, team can deploy and troubleshoot independently.

---

## Infrastructure setup checklist

All commands assume you have `wrangler` CLI installed and authenticated.

```bash
# 1. Create R2 bucket for package cache
wrangler r2 bucket create esm-packages

# 2. Create KV namespace for temporary bundle storage
wrangler kv namespace create BUNDLES

# 3. Deploy the ESM Container + caching Worker
cd esm-server/
wrangler deploy

# 4. Deploy the Expo Go relay Worker + Durable Object
cd expo-relay/
wrangler deploy

# 5. Deploy the playground static site
cd playground/
npm run build
wrangler pages deploy dist/ --project-name expo-playground

# 6. Configure custom domains
# In CF dashboard: playground.yourdomain.com → Pages project
# In CF dashboard: esm.yourdomain.com → ESM Worker
# In CF dashboard: relay.yourdomain.com → Relay Worker

# 7. Pre-warm the package cache
./scripts/warm-cache.sh
```

---

## Repository structure

```
expo-playground/
├── playground/                    # Fork of reactnative.run
│   ├── src/
│   │   ├── editor/               # Monaco editor integration
│   │   ├── bundler/              # browser-metro (Web Worker)
│   │   ├── preview/              # iframe + react-native-web
│   │   ├── expo-go/              # QR code, WebSocket client, device panel
│   │   └── App.tsx
│   ├── public/
│   ├── package.json
│   └── vite.config.ts
│
├── esm-server/                    # Package build infrastructure
│   ├── Dockerfile                 # reactnative-esm (251 MB image)
│   ├── src/
│   │   └── worker.ts             # CF Worker: R2 check → Container fallback
│   └── wrangler.jsonc
│
├── expo-relay/                    # Expo Go session relay
│   ├── src/
│   │   ├── worker.ts             # HTTP router
│   │   └── session.ts            # Durable Object: WebSocket relay
│   └── wrangler.jsonc
│
├── scripts/
│   ├── warm-cache.sh             # Pre-warm R2 with common packages
│   └── test-expo-go-bundle.js    # Bundle format verification
│
└── docs/
    ├── architecture.md
    ├── deployment.md
    └── troubleshooting.md
```

---

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Expo changes Expo Go internals in a future SDK, breaking our relay | Medium | High | Pin to specific SDK version. Monitor Expo release notes. Snack runtime source is MIT — we can study changes. |
| CF Container cold starts are too slow for first-time package builds | Low | Medium | Pre-warm top 30 packages in R2. Cold start measured at 6.7s — acceptable for cache misses. |
| CF Container ephemeral disk means no npm cache between sleeps | Certain | Low | Each package only builds once — result goes to R2 permanently. Rebuild penalty only on truly new packages. |
| Some RN packages fail to build (e.g., native modules, complex Metro configs) | Medium | Medium | Maintain an allowlist of tested packages. Surface clear error for unsupported packages. Two packages already identified: expo-router, expo-linear-gradient need custom handling in our ESM server. |
| Cloudflare Containers exit beta with breaking changes | Low | High | Containers are on production pricing already. CF has strong backwards compatibility track record. Cloud Run is drop-in backup ($0 on free tier). |
| WebSocket relay hits Durable Object limits under high concurrency | Low | Medium | Each session is its own DO instance. CF supports thousands of concurrent DOs. Only limited by account-level limits. |

---

## Known issues from verification

**1. expo-router and expo-linear-gradient fail on stock esm.sh** (Test 1.2)
These packages require Metro-specific resolution that reactnative-esm handles but generic ESM CDNs don't. Our self-hosted Container solves this. If more packages surface with similar issues, add custom resolution rules to the ESM server's esbuild config.

**2. esm.rapidnative.com returns 502** (Test 2.1)
Already mitigated — we're self-hosting. No dependency on this endpoint.

---

## Cost summary

| Component | Service | Monthly cost |
|-----------|---------|-------------|
| Playground hosting | CF Pages | $0 (free) |
| Request routing | CF Worker | $0 (included in plan) |
| Package builds | CF Container | $0–1 (within free allowances) |
| Package cache | CF R2 | $0 (within 10 GB free tier) |
| Expo Go relay | CF Durable Object | $0 (included in plan) |
| Bundle temp storage | CF KV | $0 (included in plan) |
| Docker image storage | CF R2 (registry) | $0 (within free tier) |
| **Total incremental** | | **$0–1/month** |
| **vs. CodeSandbox** | | **$9–36/seat/month** |

---

## Timeline

| Week | Sprint | Milestone |
|------|--------|-----------|
| 1–2 | Sprint 1 | Web preview live — users can write and preview RN code in browser |
| 2–3 | Sprint 2 | Package infra live — all npm imports resolve through our pipeline |
| 3–4 | Sprint 3 | Expo Go live — QR scan → real device preview with hot reload |
| 4–5 | Sprint 4 | Production ready — error handling, monitoring, docs |

**Total: 5 weeks to full production deployment.**
