#!/usr/bin/env bun
/**
 * preview-sw verification suite — runner.
 *
 * Loads `harness.html` in headless Chromium (via Puppeteer, which is
 * already a dev dep of the integration tree), waits for all scenarios
 * to complete, screenshots each scenario card, and writes the result
 * map + per-scenario screenshots to `./results/`.
 *
 * Usage:
 *
 *   cd apps/web/client/verification/preview-sw
 *   bun run run.ts
 *
 * Exits with code 0 when every scenario passes, 1 otherwise.
 *
 * The suite is fully self-contained — it does NOT need the Onlook
 * Next.js app, the Postgres backend, or any auth. It serves the harness
 * + a copy of preview-sw.js from a one-shot Node http server on a free
 * port and tears down everything when done.
 *
 * Reference screenshots from a known-good run live in `./reference/`
 * and are committed to the repo. After re-running, diff
 * `results/<scenario>.png` against `reference/<scenario>.png` to spot
 * regressions. There is no automatic pixel-diff because Sucrase output
 * + Chrome rendering is deterministic enough that DOM assertions in the
 * harness itself catch real regressions; the screenshots are for human
 * eyes.
 */
import { createServer } from 'http';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { existsSync } from 'fs';
import { extname, join, dirname } from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const HERE = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(HERE, 'results');
const PORT = Number(process.env.VERIFY_PORT ?? 8765);

const SCENARIO_IDS = ['01', '02', '03', '04', '05', '06'] as const;

const MIME: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript',
    '.css': 'text/css',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.json': 'application/json',
};

async function startServer(): Promise<{ url: string; close: () => Promise<void> }> {
    return new Promise((resolve, reject) => {
        const server = createServer(async (req, res) => {
            try {
                const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
                let pathname = url.pathname;
                if (pathname === '/') pathname = '/harness.html';
                // Disallow path traversal
                if (pathname.includes('..')) {
                    res.writeHead(400);
                    res.end('bad path');
                    return;
                }
                const filePath = join(HERE, pathname);
                if (!existsSync(filePath)) {
                    res.writeHead(404);
                    res.end('not found');
                    return;
                }
                const body = await readFile(filePath);
                const type = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
                res.writeHead(200, {
                    'Content-Type': type,
                    // Service workers must NOT be cached aggressively
                    'Cache-Control': 'no-store',
                });
                res.end(body);
            } catch (err) {
                res.writeHead(500);
                res.end(String(err));
            }
        });
        server.on('error', reject);
        server.listen(PORT, '127.0.0.1', () => {
            const url = `http://127.0.0.1:${PORT}/`;
            resolve({
                url,
                async close() {
                    await new Promise<void>((r) => server.close(() => r()));
                },
            });
        });
    });
}

async function run(): Promise<number> {
    if (!existsSync(RESULTS)) {
        await mkdir(RESULTS, { recursive: true });
    }

    console.log('[verify] starting static server on port', PORT);
    const { url, close } = await startServer();

    let exitCode = 0;
    let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
    try {
        console.log('[verify] launching headless Chromium…');
        browser = await puppeteer.launch({
            headless: true,
            // The bundled Chromium ships with puppeteer; no separate install
            // step is needed.
            args: ['--no-sandbox', '--disable-setuid-sandbox'],
        });
        const page = await browser.newPage();
        await page.setViewport({ width: 1100, height: 1400, deviceScaleFactor: 2 });

        page.on('console', (msg) => {
            const type = msg.type();
            if (type === 'error' || type === 'warn') {
                console.log(`[harness ${type}]`, msg.text());
            }
        });

        console.log('[verify] navigating to', url);
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 15000 });

        console.log('[verify] waiting for scenarios to complete…');
        await page.waitForFunction(
            () => Boolean((window as unknown as { __verifyResults?: unknown }).__verifyResults),
            { timeout: 30000 },
        );

        const results = await page.evaluate(
            () => (window as unknown as { __verifyResults: unknown }).__verifyResults,
        );

        await writeFile(join(RESULTS, 'results.json'), JSON.stringify(results, null, 2) + '\n', 'utf8');
        console.log('[verify] results.json written');

        // Per-scenario element screenshots
        for (const id of SCENARIO_IDS) {
            const elem = await page.$(`#scenario-${id}`);
            if (!elem) {
                console.log(`[verify] scenario-${id} element missing — skipping screenshot`);
                continue;
            }
            const out = join(RESULTS, `${id}-scenario.png`);
            await elem.screenshot({ path: out as `${string}.png` });
            console.log(`[verify] saved ${out}`);
        }

        // Full-page rollup
        const rollup = join(RESULTS, '00-rollup.png');
        await page.screenshot({ path: rollup as `${string}.png`, fullPage: true });
        console.log(`[verify] saved ${rollup}`);

        const summary = results as { total: number; pass: number; fail: number; scenarios: Record<string, { state: string; detail?: string }> };
        console.log('');
        console.log('==================================================');
        console.log(`  ${summary.pass}/${summary.total} scenarios passed (${summary.fail} fail)`);
        console.log('==================================================');
        for (const id of SCENARIO_IDS) {
            const r = summary.scenarios?.[id];
            if (!r) continue;
            const mark = r.state === 'pass' ? '✓' : '✗';
            const detail = r.detail ? `  (${r.detail})` : '';
            console.log(`  ${mark} ${id} — ${r.state}${detail}`);
        }
        console.log('');

        if (summary.fail > 0 || summary.pass < summary.total) {
            exitCode = 1;
        }
    } catch (err) {
        console.error('[verify] runner crashed:', err);
        exitCode = 2;
    } finally {
        if (browser) {
            await browser.close();
        }
        await close();
        console.log('[verify] server stopped');
    }

    return exitCode;
}

run().then((code) => process.exit(code));
