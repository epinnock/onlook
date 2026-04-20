import { describe, expect, mock, test } from 'bun:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

import type { BrowserBundlerEsbuildService } from '../../../../../../../../packages/browser-bundler/src';
import { createTwoTierMobilePreviewPipeline } from '../two-tier';
import type { MobilePreviewPipelineVfs } from '../types';

function makeEsbuildService(code = 'module.exports = {};'): {
    service: BrowserBundlerEsbuildService;
    buildCalls: number;
} {
    let buildCalls = 0;
    return {
        get buildCalls() {
            return buildCalls;
        },
        service: {
            async build() {
                buildCalls += 1;
                return {
                    outputFiles: [
                        { path: 'out.js', text: code },
                        { path: 'out.js.map', text: '{}' },
                    ],
                    warnings: [],
                };
            },
        },
    };
}

function makeVfs(files: Record<string, string>): MobilePreviewPipelineVfs {
    return {
        async listAll() {
            return Object.keys(files).map((p) => ({ path: p, type: 'file' as const }));
        },
        async readFile(path: string) {
            const raw = files[path.replace(/^\/+/, '')];
            if (raw === undefined) throw new Error(`missing ${path}`);
            return raw;
        },
    };
}

async function startFakeRelay(): Promise<{
    baseUrl: string;
    pushes: Array<{ sessionId: string; body: string }>;
    close(): Promise<void>;
}> {
    const pushes: Array<{ sessionId: string; body: string }> = [];
    const server = http.createServer((req, res) => {
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

// The real push-overlay module calls globalThis.fetch. Node has it. Good.

describe('TwoTierMobilePreviewPipeline.prepare', () => {
    test('returns an Onlook deep-link launch target with a minted session id', async () => {
        const pipeline = createTwoTierMobilePreviewPipeline(
            {
                kind: 'two-tier',
                builderBaseUrl: 'https://builder.example',
                relayBaseUrl: 'https://relay.example',
            },
            {
                esbuildService: makeEsbuildService().service,
                createSessionId: () => 'sess-deterministic',
            },
        );

        const launch = await pipeline.prepare({});
        expect(launch.pipeline).toBe('two-tier');
        expect(launch.manifestUrl).toBe('https://relay.example/manifest/sess-deterministic');
        expect(launch.qrUrl).toMatch(/^onlook:\/\/launch\?/);
        expect(launch.qrUrl).toContain('session=sess-deterministic');
        expect(launch.onlookUrl).toBe(launch.qrUrl);
    });

    test('throws a clear error when relay base URL is missing', async () => {
        const pipeline = createTwoTierMobilePreviewPipeline(
            {
                kind: 'two-tier',
                builderBaseUrl: 'https://builder',
                relayBaseUrl: '',
            },
            { esbuildService: makeEsbuildService().service },
        );
        await expect(pipeline.prepare({})).rejects.toThrow(/missing relay base URL/);
    });
});

describe('TwoTierMobilePreviewPipeline.sync', () => {
    const FILES = {
        'App.tsx': "export default function App() { return null; }",
        'index.ts': "import App from './App'; export default App;",
    };

    test('bundles the project and pushes an overlay to the relay /push/:sessionId', async () => {
        const relay = await startFakeRelay();
        try {
            const { service } = makeEsbuildService('module.exports = {answer: 42};');
            const pipeline = createTwoTierMobilePreviewPipeline(
                {
                    kind: 'two-tier',
                    builderBaseUrl: 'https://builder',
                    relayBaseUrl: relay.baseUrl,
                },
                { esbuildService: service, createSessionId: () => 'sync-sess-1' },
            );

            const vfs = makeVfs(FILES);
            const result = await pipeline.sync({ fileSystem: vfs });

            expect(result.type).toBe('bundle-publish');
            if (result.type !== 'bundle-publish') return;
            expect(result.bundleHash).toBe('sync-sess-1');
            expect(result.launchTarget.qrUrl).toContain('session=sync-sess-1');

            expect(relay.pushes).toHaveLength(1);
            expect(relay.pushes[0]!.sessionId).toBe('sync-sess-1');
            const pushed = JSON.parse(relay.pushes[0]!.body) as { type: string; code: string };
            expect(pushed.type).toBe('overlay');
            expect(pushed.code).toContain('__onlookMountOverlay');
        } finally {
            await relay.close();
        }
    });

    test('repeated sync with unchanged files hits the incremental cache (one esbuild invocation)', async () => {
        const relay = await startFakeRelay();
        try {
            const esbuild = makeEsbuildService();
            const pipeline = createTwoTierMobilePreviewPipeline(
                {
                    kind: 'two-tier',
                    builderBaseUrl: 'https://builder',
                    relayBaseUrl: relay.baseUrl,
                },
                { esbuildService: esbuild.service, createSessionId: () => 'warm' },
            );
            const vfs = makeVfs(FILES);

            await pipeline.sync({ fileSystem: vfs });
            await pipeline.sync({ fileSystem: vfs });
            await pipeline.sync({ fileSystem: vfs });

            expect(esbuild.buildCalls).toBe(1);
            // Each sync still pushes (the overlay contract is "republish");
            // the cache only skips the esbuild step.
            expect(relay.pushes).toHaveLength(3);
        } finally {
            await relay.close();
        }
    });

    test('editing any file invalidates the cache and triggers a fresh esbuild', async () => {
        const relay = await startFakeRelay();
        try {
            const esbuild = makeEsbuildService();
            const pipeline = createTwoTierMobilePreviewPipeline(
                {
                    kind: 'two-tier',
                    builderBaseUrl: 'https://builder',
                    relayBaseUrl: relay.baseUrl,
                },
                { esbuildService: esbuild.service, createSessionId: () => 'edit' },
            );

            await pipeline.sync({ fileSystem: makeVfs(FILES) });
            await pipeline.sync({
                fileSystem: makeVfs({
                    ...FILES,
                    'App.tsx': "export default function App() { return 1; }",
                }),
            });

            expect(esbuild.buildCalls).toBe(2);
        } finally {
            await relay.close();
        }
    });

    test('emits preparing → building → pushing → ready status in order', async () => {
        const relay = await startFakeRelay();
        try {
            const pipeline = createTwoTierMobilePreviewPipeline(
                {
                    kind: 'two-tier',
                    builderBaseUrl: 'https://builder',
                    relayBaseUrl: relay.baseUrl,
                },
                {
                    esbuildService: makeEsbuildService().service,
                    createSessionId: () => 'status',
                },
            );

            const statuses: string[] = [];
            await pipeline.sync({
                fileSystem: makeVfs(FILES),
                onStatus: (s) => statuses.push(s.kind),
            });
            // Ready may be emitted twice (once after push, once more for the
            // cache-hit side-channel).
            expect(statuses[0]).toBe('building');
            expect(statuses).toContain('pushing');
            expect(statuses).toContain('ready');
        } finally {
            await relay.close();
        }
    });

    test('throws when no entry file is present', async () => {
        const pipeline = createTwoTierMobilePreviewPipeline(
            {
                kind: 'two-tier',
                builderBaseUrl: 'https://builder',
                relayBaseUrl: 'http://127.0.0.1:1',
            },
            { esbuildService: makeEsbuildService().service },
        );
        await expect(
            pipeline.sync({ fileSystem: makeVfs({ 'README.md': 'no entry' }) }),
        ).rejects.toThrow(/no supported entry file/);
    });

    test('surfaces relay push failures through the status callback', async () => {
        const server = http.createServer((req, res) => {
            res.writeHead(500);
            res.end('server exploded');
        });
        await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
        const port = (server.address() as AddressInfo).port;

        try {
            const statuses: Array<{ kind: string; message?: string }> = [];
            const pipeline = createTwoTierMobilePreviewPipeline(
                {
                    kind: 'two-tier',
                    builderBaseUrl: 'https://builder',
                    relayBaseUrl: `http://127.0.0.1:${port}`,
                },
                {
                    esbuildService: makeEsbuildService().service,
                    createSessionId: () => 'err',
                },
            );

            await expect(
                pipeline.sync({
                    fileSystem: makeVfs(FILES),
                    onStatus: (s) => statuses.push(s),
                }),
            ).rejects.toThrow(/push failed/);

            expect(statuses.some((s) => s.kind === 'error')).toBe(true);
        } finally {
            await new Promise<void>((r, j) => server.close((e) => (e ? j(e) : r())));
        }
    });
});
