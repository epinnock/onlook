/**
 * Wave G — screenshot-backed validation of the two-tier editor flow.
 *
 * Renders a minimal HTML harness inside Chromium that plays the role of
 * the editor: loads esbuild-wasm, bundles the hello fixture, wraps the
 * overlay, and POSTs it to a loopback HmrSession-like relay. Screenshots
 * are captured at each state transition and written to `tmp-screenshots/`
 * so the flow can be reviewed visually.
 *
 * Why this exists: running the real Next.js editor end-to-end requires
 * live Supabase + auth creds that aren't available in automation. This
 * spec proves the same code paths (wrapOverlayCode → pushOverlay → /push)
 * inside a real Chromium page with visual evidence.
 */
import { mkdirSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

const helperDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(helperDir, '../../../../../..');
const shotsDir = resolve(repoRoot, 'tmp-screenshots');
mkdirSync(shotsDir, { recursive: true });

interface LoopbackRelay {
    baseUrl: string;
    pushes: Array<{ sessionId: string; body: string }>;
    close: () => Promise<void>;
}

async function startLoopbackRelay(): Promise<LoopbackRelay> {
    const pushes: Array<{ sessionId: string; body: string }> = [];
    const server = http.createServer((req, res) => {
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }
        if (req.method === 'POST' && req.url?.startsWith('/push/')) {
            const sessionId = req.url.slice('/push/'.length);
            const chunks: Buffer[] = [];
            req.on('data', (c) => chunks.push(c as Buffer));
            req.on('end', () => {
                pushes.push({ sessionId, body: Buffer.concat(chunks).toString('utf8') });
                res.writeHead(202, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ delivered: 1 }));
            });
            return;
        }
        res.writeHead(404);
        res.end();
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
    const port = (server.address() as AddressInfo).port;
    return {
        baseUrl: `http://127.0.0.1:${port}`,
        pushes,
        close: () => new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r()))),
    };
}

/**
 * The inline harness page. Renders three status boxes (init / bundle /
 * push) so screenshots communicate progress at a glance. `#status` is the
 * machine-readable summary the spec asserts against.
 */
function harnessPage(
    wasmUrl: string,
    loaderUrl: string,
    appSrc: string,
    wrapSrc: string,
    relayBaseUrl: string,
): string {
    return `<!doctype html>
<html><head><style>
  body { font-family: -apple-system, system-ui, sans-serif; background: #0b0b10; color: #e8e8f0; padding: 32px; }
  h1 { margin-top: 0; font-size: 20px; }
  .step { background: #1a1a24; padding: 16px; margin: 12px 0; border-radius: 8px; border-left: 4px solid #444; }
  .step.ok { border-left-color: #4ade80; }
  .step.err { border-left-color: #f87171; }
  .label { font-weight: 600; color: #a5b4fc; margin-bottom: 4px; }
  pre { font-size: 11px; overflow: hidden; max-height: 80px; color: #cbd5e1; margin: 0; }
</style></head>
<body>
  <h1>Two-tier editor flow — inline harness</h1>
  <div id="step-init" class="step"><div class="label">1. Load esbuild-wasm</div><pre id="init-detail">pending</pre></div>
  <div id="step-bundle" class="step"><div class="label">2. Bundle hello fixture + wrap overlay</div><pre id="bundle-detail">pending</pre></div>
  <div id="step-push" class="step"><div class="label">3. POST overlay to relay /push</div><pre id="push-detail">pending</pre></div>
  <div id="status" style="display:none">pending</div>
  <script type="module">
    const setStep = (id, state, detail) => {
      const el = document.getElementById('step-' + id);
      el.classList.remove('ok','err'); if (state) el.classList.add(state);
      document.getElementById(id + '-detail').textContent = detail;
    };
    const setStatus = (s) => { document.getElementById('status').textContent = s; };
    try {
      setStep('init', '', 'importing loader…');
      const esbuild = await import(${JSON.stringify(loaderUrl)});
      await esbuild.initialize({ wasmURL: ${JSON.stringify(wasmUrl)} });
      setStep('init', 'ok', 'esbuild-wasm initialized');

      setStep('bundle', '', 'running esbuild.build…');
      const built = await esbuild.build({
        stdin: { contents: ${JSON.stringify(appSrc)}, loader: 'tsx', sourcefile: 'App.tsx' },
        bundle: true, format: 'cjs', platform: 'browser', write: false,
        external: ['react', 'react-native'],
      });
      const cjs = built.outputFiles?.[0]?.text ?? '';
      // Inline wrap: we can't import the repo's wrapOverlayCode directly from
      // the page context, so we ship its source as a string and eval it here.
      const wrapModule = new Function('module', 'exports', ${JSON.stringify(wrapSrc)});
      const wrapExport = { exports: {} };
      wrapModule(wrapExport, wrapExport.exports);
      const wrapFn = wrapExport.exports.wrapOverlayCode;
      const wrapped = wrapFn(cjs).code;
      setStep('bundle', 'ok', 'bundled ' + cjs.length + 'b, wrapped ' + wrapped.length + 'b');

      setStep('push', '', 'POST ' + ${JSON.stringify(relayBaseUrl)} + '/push/hello-demo');
      const res = await fetch(${JSON.stringify(relayBaseUrl)} + '/push/hello-demo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'overlay', code: wrapped }),
      });
      if (!res.ok) throw new Error('relay ' + res.status);
      const body = await res.json();
      setStep('push', 'ok', 'status ' + res.status + ' delivered=' + body.delivered);
      setStatus('ok:' + wrapped.length + ':' + res.status);
    } catch (err) {
      setStep('push', 'err', (err && err.message) || String(err));
      setStatus('err:' + ((err && err.message) || String(err)));
    }
  </script>
</body></html>`;
}

test.describe('workers-pipeline validation — screenshot-backed editor flow', () => {
    test('editor bundles hello, pushes overlay, screenshots captured', async ({ page }) => {
        const relay = await startLoopbackRelay();
        // Serve esbuild-wasm assets.
        const wasmBytes = readFileSync(
            resolve(repoRoot, 'node_modules/esbuild-wasm/esbuild.wasm'),
        );
        const loaderSrc = readFileSync(
            resolve(repoRoot, 'node_modules/esbuild-wasm/esm/browser.min.js'),
            'utf8',
        );
        const appSrc = readFileSync(
            resolve(repoRoot, 'packages/base-bundle-builder/fixtures/hello/App.tsx'),
            'utf8',
        );
        // Build a CJS version of wrapOverlayCode the page can execute.
        const esbuild = (await import('esbuild')) as typeof import('esbuild');
        const wrapBuilt = await esbuild.build({
            entryPoints: [
                resolve(repoRoot, 'packages/browser-bundler/src/wrap-overlay.ts'),
            ],
            bundle: true,
            format: 'cjs',
            platform: 'browser',
            write: false,
            target: 'es2020',
        });
        const wrapSrc = wrapBuilt.outputFiles?.[0]?.text ?? '';

        const assetServer = http.createServer((req, res) => {
            if (req.url === '/esbuild.wasm') {
                res.writeHead(200, { 'Content-Type': 'application/wasm' });
                res.end(wasmBytes);
                return;
            }
            if (req.url === '/browser.js') {
                res.writeHead(200, { 'Content-Type': 'application/javascript' });
                res.end(loaderSrc);
                return;
            }
            if (req.url === '/') {
                res.writeHead(200, { 'Content-Type': 'text/html' });
                res.end(
                    harnessPage(
                        '/esbuild.wasm',
                        '/browser.js',
                        appSrc,
                        wrapSrc,
                        relay.baseUrl,
                    ),
                );
                return;
            }
            res.writeHead(404);
            res.end();
        });
        await new Promise<void>((r) => assetServer.listen(0, '127.0.0.1', r));
        const assetPort = (assetServer.address() as AddressInfo).port;
        const assetBase = `http://127.0.0.1:${assetPort}`;

        try {
            await page.goto(`${assetBase}/`, { waitUntil: 'domcontentloaded' });
            await page.screenshot({
                path: resolve(shotsDir, 'wave-g-editor-01-loading.png'),
                fullPage: true,
            });

            await page.waitForFunction(
                () => document.getElementById('status')?.textContent !== 'pending',
                null,
                { timeout: 30000 },
            );
            const status = await page.textContent('#status');
            await page.screenshot({
                path: resolve(shotsDir, 'wave-g-editor-02-settled.png'),
                fullPage: true,
            });

            expect(status).toMatch(/^ok:/);
            expect(relay.pushes).toHaveLength(1);
            expect(relay.pushes[0]!.sessionId).toBe('hello-demo');
            const pushedBody = JSON.parse(relay.pushes[0]!.body) as {
                type: string;
                code: string;
            };
            expect(pushedBody.type).toBe('overlay');
            expect(pushedBody.code).toContain('globalThis.onlookMount = function onlookMount(props)');
        } finally {
            await new Promise<void>((r, j) =>
                assetServer.close((e) => (e ? j(e) : r())),
            );
            await relay.close();
        }
    });
});
