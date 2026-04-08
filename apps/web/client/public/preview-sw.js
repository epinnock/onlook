/**
 * preview-sw.js — service worker for the ExpoBrowser preview iframe.
 *
 * Wave H §1.3 of plans/expo-browser-implementation.md.
 *
 * Intercepts /preview/<branchId>/<frameId>/* requests in the editor's
 * origin and serves an HTML shell + bundled JS for the in-browser Expo
 * preview. The bundle itself is published by @onlook/browser-metro on a
 * BroadcastChannel; this worker subscribes to that channel and caches
 * the latest result in memory.
 *
 * Why a service worker (and not srcdoc):
 *   - Each <Frame> on the canvas already has a persisted `url` field;
 *     replacing it with srcdoc would break the multi-frame model.
 *   - Penpal click-to-edit needs a real iframe load lifecycle.
 *   - Same-origin URL means html2canvas screenshot capture works (Wave H
 *     §1.8) without cross-origin restrictions.
 *
 * The worker is registered by preview-sw-register.tsx — a client island
 * that mounts inside the project route only when the active branch's
 * providerType is 'expo_browser'.
 */
/* eslint-disable no-undef, no-restricted-globals */

const VERSION = 'v1';
const PREVIEW_PREFIX = '/preview/';
const BROADCAST_CHANNEL = 'onlook-preview';
const BUNDLE_CACHE_NAME = 'onlook-preview-bundles';

/** Latest bundle keyed by branchId (fast path; survives until SW restart). */
const bundleCache = new Map();

/**
 * Build a synthetic URL used as the cache key for a branch's latest bundle.
 * The URL is never fetched over the network — it exists only so we can use
 * the Cache Storage API to persist bundles across SW restarts (TR3.1).
 */
function cacheKeyForBranch(branchId) {
    return `https://onlook-preview/bundles/${encodeURIComponent(branchId)}`;
}

async function persistBundle(branchId, result) {
    try {
        const cache = await caches.open(BUNDLE_CACHE_NAME);
        const body = JSON.stringify(result);
        const response = new Response(body, {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store',
            },
        });
        await cache.put(cacheKeyForBranch(branchId), response);
    } catch (err) {
        console.warn('[preview-sw] failed to persist bundle:', err);
    }
}

async function loadPersistedBundle(branchId) {
    try {
        const cache = await caches.open(BUNDLE_CACHE_NAME);
        const response = await cache.match(cacheKeyForBranch(branchId));
        if (!response) return null;
        const text = await response.text();
        return JSON.parse(text);
    } catch (err) {
        console.warn('[preview-sw] failed to load persisted bundle:', err);
        return null;
    }
}

self.addEventListener('install', (event) => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

// Two delivery channels for bundle updates from BrowserMetro running on
// the main thread:
//
//   1. `self.addEventListener('message', ...)` — `registration.active.postMessage(data)`
//      from the page is the most reliable way to talk to a service worker.
//      The SW must be active when the message is sent. This is the
//      primary path used by the Wave H integration in
//      apps/web/client/src/components/preview/preview-sw-register.tsx.
//
//   2. `BroadcastChannel('onlook-preview')` — best-effort fallback for the
//      BrowserMetro host class to publish on. BroadcastChannel delivery
//      to a SW that is *not* controlling the publishing page is not
//      guaranteed across browsers (Chrome ships it; Safari historically
//      didn't), so this is treated as opportunistic.
//
// Both deliver the same `{ type: 'bundle', branchId, result }` payload.
//
// When a bundle arrives we write to BOTH the in-memory Map (fast path for
// subsequent fetches within this SW lifetime) AND the Cache Storage API
// (durability across SW restarts and iframe hard reloads). A new bundle for
// the same branchId overwrites the previous cache entry — the editor
// controls freshness via push; no TTL.
function handleBundleMessage(data) {
    if (!data || data.type !== 'bundle') return;
    const result = data.result;
    const branchId = data.branchId;
    if (!result || !branchId) return;
    bundleCache.set(branchId, result);
    return persistBundle(branchId, result);
}

self.addEventListener('message', (event) => {
    const promise = handleBundleMessage(event.data);
    if (promise && event.waitUntil) {
        event.waitUntil(promise);
    }
});

let broadcastChannel = null;
try {
    broadcastChannel = new BroadcastChannel(BROADCAST_CHANNEL);
    broadcastChannel.addEventListener('message', (event) => handleBundleMessage(event.data));
} catch (err) {
    console.warn('[preview-sw] BroadcastChannel unavailable:', err);
}

self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    if (url.origin !== self.location.origin) return;
    if (!url.pathname.startsWith(PREVIEW_PREFIX)) return;

    event.respondWith(handlePreviewRequest(url));
});

/**
 * Route /preview/<branchId>/<frameId>/<rest> to the right resource.
 *   - /preview/<branchId>/<frameId>/                 → HTML shell
 *   - /preview/<branchId>/<frameId>/bundle.js        → latest bundle (IIFE)
 *   - /preview/<branchId>/<frameId>/importmap.json   → latest importmap
 *   - /preview/<branchId>/<frameId>/_assets/<file>   → static helpers
 */
async function handlePreviewRequest(url) {
    const segments = url.pathname.slice(PREVIEW_PREFIX.length).split('/').filter(Boolean);
    const branchId = segments[0];
    const frameId = segments[1];
    const rest = segments.slice(2).join('/');

    if (!branchId) {
        return new Response('preview-sw: missing branchId', { status: 400 });
    }

    if (!rest || rest === '') {
        // HTML shell for the iframe
        return new Response(htmlShell(branchId, frameId ?? 'default'), {
            status: 200,
            headers: {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'no-store',
            },
        });
    }

    if (rest === 'bundle.js') {
        const bundle = await getBundle(branchId);
        if (!bundle) {
            return new Response(
                `// preview-sw: no bundle yet for branch ${branchId}\n` +
                    `console.warn('[browser-metro] waiting for first bundle...');\n`,
                {
                    status: 200,
                    headers: {
                        'Content-Type': 'application/javascript',
                        'Cache-Control': 'no-store',
                    },
                },
            );
        }
        // TR2.5 landed a self-contained IIFE in the bundle — the SW just
        // ships it verbatim. Stitching modules is the iframe's job.
        const body = typeof bundle.iife === 'string' ? bundle.iife : serializeBundle(bundle);
        return new Response(body, {
            status: 200,
            headers: {
                'Content-Type': 'application/javascript',
                'Cache-Control': 'no-store',
            },
        });
    }

    if (rest === 'importmap.json') {
        const bundle = await getBundle(branchId);
        if (!bundle || typeof bundle.importmap !== 'string') {
            // Minimal empty importmap so the iframe shell's <script type="importmap">
            // tag still parses while we wait for the first bundle.
            return new Response(JSON.stringify({ imports: {} }), {
                status: 200,
                headers: {
                    'Content-Type': 'application/json',
                    'Cache-Control': 'no-store',
                },
            });
        }
        return new Response(bundle.importmap, {
            status: 200,
            headers: {
                'Content-Type': 'application/json',
                'Cache-Control': 'no-store',
            },
        });
    }

    return new Response(`preview-sw: unknown path ${rest}`, { status: 404 });
}

/**
 * Look up the latest bundle for a branch: in-memory first (fast path),
 * then Cache Storage (survives SW restart). Hydrates the in-memory map
 * on cache hit so subsequent requests in this SW lifetime hit the fast
 * path.
 */
async function getBundle(branchId) {
    const memo = bundleCache.get(branchId);
    if (memo) return memo;
    const persisted = await loadPersistedBundle(branchId);
    if (persisted) {
        bundleCache.set(branchId, persisted);
        return persisted;
    }
    return null;
}

/**
 * Build a minimal IIFE that defines every module in the bundle and runs
 * the entry point. This is intentionally simple — production-grade
 * bundling (chunk loading, source maps, React Refresh) is the Sprint 2/3
 * stretch from the Wave C scaffold notes.
 */
function serializeBundle(bundle) {
    const entry = bundle.entry;
    const moduleEntries = Object.entries(bundle.modules)
        .map(([path, mod]) => {
            return `  ${JSON.stringify(path)}: function(module, exports, require) {\n${mod.code}\n  }`;
        })
        .join(',\n');

    return `
(function() {
  var __modules = {
${moduleEntries}
  };
  var __cache = {};
  function __require(path) {
    if (__cache[path]) return __cache[path].exports;
    var module = { exports: {} };
    __cache[path] = module;
    var fn = __modules[path];
    if (!fn) {
      throw new Error('Module not found: ' + path);
    }
    fn(module, module.exports, __require);
    return module.exports;
  }
  try {
    __require(${JSON.stringify(entry)});
    if (window.parent && window.parent.postMessage) {
      window.parent.postMessage({ type: 'browser-metro:bundle-ready', entry: ${JSON.stringify(entry)} }, '*');
    }
  } catch (err) {
    console.error('[browser-metro] runtime error:', err);
    document.body.innerHTML = '<pre style="color:#b91c1c;padding:1rem;font-family:monospace;">' + (err && err.stack ? err.stack : String(err)) + '</pre>';
  }
})();
`;
}

function htmlShell(branchId, frameId) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1.0" />
    <title>Onlook Browser Preview</title>
    <style>
        html, body { margin: 0; padding: 0; background: #fafafa; font-family: -apple-system, system-ui, sans-serif; }
        #root { min-height: 100vh; }
        #__loading { padding: 1rem; color: #6b7280; font-size: 0.875rem; }
    </style>
</head>
<body data-branch-id="${branchId}" data-frame-id="${frameId}">
    <div id="root">
        <div id="__loading">Loading browser preview…</div>
    </div>
    <script src="/onlook-preload-script.js"></script>
    <script src="bundle.js"></script>
</body>
</html>`;
}
