/**
 * workers-pipeline browser-bundler — Chromium-side harness spec.
 *
 * Drives the browser-side contracts of the two-tier pipeline inside a real
 * Chromium page via Playwright:
 *
 *   1. `wrapOverlayCode` produces the IIFE/mount shape when invoked in the
 *      browser (not just Node).
 *   2. `preflightUnsupportedImports` classifies bare imports identically in
 *      Chromium and Node — important because the editor's browser-bundler
 *      runs this in a Web Worker.
 *   3. A Chromium-side `fetch()` can POST to a loopback relay using the
 *      exact wire shape the Node push-client emits.
 *
 * NOT covered here (follow-up): running esbuild-wasm inside the page. The
 * workspace does not currently list `esbuild-wasm` as a dep — enabling that
 * would touch the lockfile, which is gated. This spec asserts the parts of
 * the in-Chromium path that exist today and will light up fully once the
 * esbuild-wasm dep lands.
 */
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

import { expect, test } from '@playwright/test';

import { DEFAULT_BASE_EXTERNALS } from '../helpers/browser-bundler-harness';

const helperDir = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(helperDir, '../../../../../..');

function readSource(relativeToRepo: string): string {
    return readFileSync(resolve(repoRoot, relativeToRepo), 'utf8');
}

async function startRecordingRelay(): Promise<{
    baseUrl: string;
    pushes: string[];
    close(): Promise<void>;
}> {
    const pushes: string[] = [];
    const server = http.createServer((req, res) => {
        // Permit CORS from the data-URL origin Playwright serves the page from.
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
        if (req.method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }
        if (req.method === 'POST' && req.url?.startsWith('/push/')) {
            const chunks: Buffer[] = [];
            req.on('data', (c) => chunks.push(c as Buffer));
            req.on('end', () => {
                pushes.push(Buffer.concat(chunks).toString('utf8'));
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

test.describe('workers-pipeline browser-bundler — Chromium harness', () => {
    test('wrapOverlayCode produces the IIFE/mount shape when evaluated in Chromium', async ({
        page,
    }) => {
        const source = readSource('packages/browser-bundler/src/wrap-overlay.ts');
        // Transpile the TypeScript down on-the-fly via esbuild so Chromium can
        // eval it. This is the same mechanism bundle-level specs use and keeps
        // the harness honest — we are not re-implementing wrapOverlayCode.
        const esbuild = (await import('esbuild')) as typeof import('esbuild');
        const { code: jsSource } = await esbuild.transform(source, {
            loader: 'ts',
            format: 'iife',
            globalName: 'BrowserBundlerWrap',
        });

        await page.setContent('<!doctype html><html><body></body></html>');
        await page.addScriptTag({ content: jsSource });

        const result = await page.evaluate(() => {
            const mod = (
                globalThis as unknown as {
                    BrowserBundlerWrap: {
                        wrapOverlayCode: (code: string) => { code: string };
                    };
                }
            ).BrowserBundlerWrap;
            return mod.wrapOverlayCode('console.log(1);').code;
        });

        expect(result).toMatch(/^\s*\(function\(\)\s*\{/);
        expect(result).toContain('globalThis["__onlookMountOverlay"]');
        expect(result).toContain('mount(');
    });

    test('preflightUnsupportedImports classifies imports identically in Chromium', async ({
        page,
    }) => {
        const preflightSrc = readSource('packages/browser-bundler/src/preflight.ts');
        const externalSrc = readSource('packages/browser-bundler/src/plugins/external.ts');
        const esbuild = (await import('esbuild')) as typeof import('esbuild');

        // Inline-bundle both files into a single IIFE via esbuild's `stdin`
        // + a tiny plugin for the ./plugins/external relative import.
        const bundled = await esbuild.build({
            stdin: {
                contents: preflightSrc.replace(
                    "from './plugins/external'",
                    "from 'virtual:external'",
                ),
                loader: 'ts',
                sourcefile: 'preflight.ts',
            },
            bundle: true,
            format: 'iife',
            globalName: 'BrowserBundlerPreflight',
            write: false,
            plugins: [
                {
                    name: 'virtual',
                    setup(build) {
                        build.onResolve({ filter: /^virtual:external$/ }, (args) => ({
                            path: args.path,
                            namespace: 'virtual',
                        }));
                        build.onLoad({ filter: /.*/, namespace: 'virtual' }, () => ({
                            contents: externalSrc,
                            loader: 'ts',
                        }));
                    },
                },
            ],
        });

        const output = bundled.outputFiles?.[0]?.text;
        expect(output).toBeDefined();

        await page.setContent('<!doctype html><html><body></body></html>');
        await page.addScriptTag({ content: output! });

        const issues = await page.evaluate((externals: readonly string[]) => {
            const mod = (
                globalThis as unknown as {
                    BrowserBundlerPreflight: {
                        preflightUnsupportedImports: (opts: {
                            files: Record<string, string>;
                            externalSpecifiers: Iterable<string>;
                        }) => ReadonlyArray<{ specifier: string; filePath: string }>;
                    };
                }
            ).BrowserBundlerPreflight;
            return mod.preflightUnsupportedImports({
                files: {
                    '/App.tsx': "import 'lodash'; import { View } from 'react-native';",
                },
                externalSpecifiers: externals,
            });
        }, DEFAULT_BASE_EXTERNALS);

        expect(issues).toHaveLength(1);
        expect(issues[0]?.specifier).toBe('lodash');
        expect(issues[0]?.filePath).toBe('/App.tsx');
    });

    test('a Chromium-side fetch() POSTs the overlay wire shape the relay expects', async ({
        page,
    }) => {
        const relay = await startRecordingRelay();
        try {
            await page.setContent('<!doctype html><html><body></body></html>');
            const status = await page.evaluate(async (baseUrl: string) => {
                const res = await fetch(`${baseUrl}/push/chromium-session`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        type: 'overlay',
                        code: 'globalThis.__onlookMountOverlay("x");',
                    }),
                });
                return res.status;
            }, relay.baseUrl);

            expect(status).toBe(202);
            expect(relay.pushes).toHaveLength(1);
            const pushed = JSON.parse(relay.pushes[0]!) as { type: string; code: string };
            expect(pushed.type).toBe('overlay');
            expect(pushed.code).toBe('globalThis.__onlookMountOverlay("x");');
        } finally {
            await relay.close();
        }
    });
});
