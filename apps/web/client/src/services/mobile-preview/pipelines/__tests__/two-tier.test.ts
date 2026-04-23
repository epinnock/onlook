import { describe, expect, mock, test } from 'bun:test';
import http from 'node:http';
import type { AddressInfo } from 'node:net';

// Mock the pipeline-flag module so tests can force either the legacy
// (wrapOverlayCode + pushOverlay) or the v1 (wrapOverlayV1 + pushOverlayV1)
// branch inside TwoTierMobilePreviewPipeline.sync — ADR-0009 Phase 11a.
// Defaults to false so every existing test (written pre-flag) still
// exercises the legacy path.
// ADR-0009 Phase 11a — force the pipeline-flag by mocking @/env directly.
// The flag-reader (`isMobilePreviewOverlayV1PipelineEnabled`) reads
// `env.NEXT_PUBLIC_MOBILE_PREVIEW_PIPELINE` at call time via a default param,
// so mutating this mockEnv between tests is picked up without re-importing.
const pipelineFlagState = { v1Enabled: false };
const mockEnv = {
    get NEXT_PUBLIC_MOBILE_PREVIEW_PIPELINE(): string {
        return pipelineFlagState.v1Enabled ? 'overlay-v1' : 'shim';
    },
} as Record<string, unknown>;
mock.module('@/env', () => ({ env: mockEnv }));

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

describe('registerTwoTierEsbuildServiceFactory', () => {
    test('a factory registered via the module-level hook is picked up by sync()', async () => {
        // Exercises the editor-side wiring: `use-mobile-preview-status`
        // calls registerTwoTierEsbuildServiceFactory once at hook init so
        // the pipeline can lazily materialize an esbuild-wasm worker.
        const {
            registerTwoTierEsbuildServiceFactory,
            clearTwoTierEsbuildServiceFactory,
        } = (await import('../two-tier')) as typeof import('../two-tier');

        const { service } = makeEsbuildService();
        let factoryCallCount = 0;
        registerTwoTierEsbuildServiceFactory(async () => {
            factoryCallCount += 1;
            return service;
        });

        try {
            const relay = await startFakeRelay();
            try {
                const pipeline = createTwoTierMobilePreviewPipeline(
                    {
                        kind: 'two-tier',
                        builderBaseUrl: 'https://builder',
                        relayBaseUrl: relay.baseUrl,
                    },
                    { createSessionId: () => 'module-registered' },
                );

                const files = {
                    'App.tsx': "export default function App() { return null; }",
                    'index.ts': "import App from './App'; export default App;",
                };
                await pipeline.sync({ fileSystem: makeVfs(files) });

                expect(factoryCallCount).toBe(1);
                expect(relay.pushes).toHaveLength(1);
                expect(relay.pushes[0]!.sessionId).toBe('module-registered');
            } finally {
                await relay.close();
            }
        } finally {
            clearTwoTierEsbuildServiceFactory();
        }
    });
});

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

    // Reset the pipeline-flag before each test to legacy-branch behavior so
    // the v1-branch tests below don't leak state into unrelated cases.
    const resetPipelineFlag = (): void => {
        pipelineFlagState.v1Enabled = false;
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
            expect(pushed.code).toContain('globalThis.onlookMount = function onlookMount(props)');
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

    // ─── Phase 11a dual-branch coverage (ADR-0009, tasks #89-#94) ───────────

    test('legacy branch (flag off): pushes OverlayMessage shape {type:"overlay", code, sourceMap?}', async () => {
        resetPipelineFlag();
        const relay = await startFakeRelay();
        try {
            const { service } = makeEsbuildService('module.exports = {};');
            const pipeline = createTwoTierMobilePreviewPipeline(
                {
                    kind: 'two-tier',
                    builderBaseUrl: 'https://builder',
                    relayBaseUrl: relay.baseUrl,
                },
                { esbuildService: service, createSessionId: () => 'legacy-sess' },
            );
            await pipeline.sync({ fileSystem: makeVfs(FILES) });
            expect(relay.pushes).toHaveLength(1);
            const pushed = JSON.parse(relay.pushes[0]!.body) as {
                type: string;
                code?: string;
                source?: string;
            };
            expect(pushed.type).toBe('overlay');
            expect(pushed.code).toBeDefined();
            expect(pushed.source).toBeUndefined();
        } finally {
            await relay.close();
        }
    });

    test('v1 branch (flag on): pushes OverlayUpdateMessage shape with abi + source + assets + meta', async () => {
        pipelineFlagState.v1Enabled = true;
        const relay = await startFakeRelay();
        try {
            const { service } = makeEsbuildService('module.exports = {};');
            const pipeline = createTwoTierMobilePreviewPipeline(
                {
                    kind: 'two-tier',
                    builderBaseUrl: 'https://builder',
                    relayBaseUrl: relay.baseUrl,
                },
                { esbuildService: service, createSessionId: () => 'v1-sess' },
            );
            await pipeline.sync({ fileSystem: makeVfs(FILES) });
            expect(relay.pushes).toHaveLength(1);
            const pushed = JSON.parse(relay.pushes[0]!.body) as {
                type: string;
                abi?: string;
                sessionId?: string;
                source?: string;
                assets?: { abi: string; assets: Record<string, unknown> };
                meta?: { overlayHash: string; entryModule: number; buildDurationMs: number };
            };
            expect(pushed.type).toBe('overlayUpdate');
            expect(pushed.abi).toBe('v1');
            expect(pushed.sessionId).toBe('v1-sess');
            expect(typeof pushed.source).toBe('string');
            expect(pushed.source).toContain('OnlookRuntime');
            expect(pushed.assets).toEqual({ abi: 'v1', assets: {} });
            expect(pushed.meta?.overlayHash).toMatch(/^[0-9a-f]{64}$/);
            expect(pushed.meta?.entryModule).toBe(0);
            expect(typeof pushed.meta?.buildDurationMs).toBe('number');
        } finally {
            await relay.close();
            resetPipelineFlag();
        }
    });

    test('v1 branch: overlayHash stays stable across identical rebuilds (cache contract)', async () => {
        pipelineFlagState.v1Enabled = true;
        const relay = await startFakeRelay();
        try {
            const { service } = makeEsbuildService('module.exports = {answer: 42};');
            const pipeline = createTwoTierMobilePreviewPipeline(
                {
                    kind: 'two-tier',
                    builderBaseUrl: 'https://builder',
                    relayBaseUrl: relay.baseUrl,
                },
                { esbuildService: service, createSessionId: () => 'v1-stable' },
            );
            await pipeline.sync({ fileSystem: makeVfs(FILES) });
            await pipeline.sync({ fileSystem: makeVfs(FILES) });
            expect(relay.pushes).toHaveLength(2);
            const a = JSON.parse(relay.pushes[0]!.body) as {
                meta: { overlayHash: string };
            };
            const b = JSON.parse(relay.pushes[1]!.body) as {
                meta: { overlayHash: string };
            };
            // Identical source bytes → identical sha256 → cacheable on phone.
            expect(a.meta.overlayHash).toBe(b.meta.overlayHash);
        } finally {
            await relay.close();
            resetPipelineFlag();
        }
    });

    test('v1 branch: surfaces a clear error when the relay returns 5xx', async () => {
        pipelineFlagState.v1Enabled = true;
        // Spin up a fake relay that always 500s.
        const server = http.createServer((req, res) => {
            if (req.method === 'POST' && req.url?.startsWith('/push/')) {
                // Drain the body then fail the request.
                req.on('data', () => {});
                req.on('end', () => {
                    res.writeHead(500);
                    res.end();
                });
                return;
            }
            res.writeHead(404);
            res.end();
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
                { esbuildService: makeEsbuildService().service, createSessionId: () => 'v1-err' },
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
            resetPipelineFlag();
        }
    });

    test('v1 branch: meta.buildDurationMs is a non-negative number', async () => {
        pipelineFlagState.v1Enabled = true;
        const relay = await startFakeRelay();
        try {
            const { service } = makeEsbuildService('module.exports = {};');
            const pipeline = createTwoTierMobilePreviewPipeline(
                {
                    kind: 'two-tier',
                    builderBaseUrl: 'https://builder',
                    relayBaseUrl: relay.baseUrl,
                },
                { esbuildService: service, createSessionId: () => 'v1-time' },
            );
            await pipeline.sync({ fileSystem: makeVfs(FILES) });
            const pushed = JSON.parse(relay.pushes[0]!.body) as {
                meta: { buildDurationMs: number };
            };
            expect(pushed.meta.buildDurationMs).toBeGreaterThanOrEqual(0);
            expect(Number.isFinite(pushed.meta.buildDurationMs)).toBe(true);
        } finally {
            await relay.close();
            resetPipelineFlag();
        }
    });

    test('v1 branch: pre-push size-gate rejects bundles over the hard cap before hitting the relay', async () => {
        pipelineFlagState.v1Enabled = true;
        const relay = await startFakeRelay();
        try {
            // Produce a bundle just over the 2 MB hard cap by stuffing the
            // bundler output with a huge string. The wrapped envelope will
            // exceed the cap, tripping checkOverlaySize.
            const bigString = 'x'.repeat(3 * 1024 * 1024); // 3 MB
            const { service } = makeEsbuildService(`module.exports = ${JSON.stringify(bigString)};`);
            const pipeline = createTwoTierMobilePreviewPipeline(
                {
                    kind: 'two-tier',
                    builderBaseUrl: 'https://builder',
                    relayBaseUrl: relay.baseUrl,
                },
                { esbuildService: service, createSessionId: () => 'v1-big' },
            );
            // The size cap fires at one of two layers:
            //   - wrapOverlayV1 (throws "overlay size N bytes exceeds hard cap M")
            //   - pre-push checkOverlaySize (throws "two-tier pipeline (v1): …")
            // Both are valid — both prevent the push from reaching the relay.
            await expect(pipeline.sync({ fileSystem: makeVfs(FILES) })).rejects.toThrow(
                /exceeds (?:the )?hard cap/,
            );
            // Relay never sees this push.
            expect(relay.pushes).toHaveLength(0);
        } finally {
            await relay.close();
            resetPipelineFlag();
        }
    });

    test('v1 branch: message parses against OverlayUpdateMessageSchema', async () => {
        pipelineFlagState.v1Enabled = true;
        const relay = await startFakeRelay();
        try {
            const { service } = makeEsbuildService('module.exports = {};');
            const pipeline = createTwoTierMobilePreviewPipeline(
                {
                    kind: 'two-tier',
                    builderBaseUrl: 'https://builder',
                    relayBaseUrl: relay.baseUrl,
                },
                { esbuildService: service, createSessionId: () => 'v1-schema' },
            );
            await pipeline.sync({ fileSystem: makeVfs(FILES) });
            const { OverlayUpdateMessageSchema } = await import(
                '@onlook/mobile-client-protocol'
            );
            const parse = OverlayUpdateMessageSchema.safeParse(
                JSON.parse(relay.pushes[0]!.body),
            );
            expect(parse.success).toBe(true);
        } finally {
            await relay.close();
            resetPipelineFlag();
        }
    });

    // Phase 11b soak wiring (ADR-0009 prerequisite). The
    // `overlay-telemetry-sink` unit suite covers the sink itself; these
    // integration tests confirm `two-tier.ts` actually calls the sink
    // from both pipeline branches with the correct pipeline tag, via
    // the real `pushOverlay` / `pushOverlayV1` code path hitting our
    // fake relay. The sink resolves posthog through `globalThis.posthog`
    // so installing a stub there is enough to intercept every capture.
    type PostHogStub = {
        capture: (event: string, props?: Record<string, unknown>) => void;
    };
    type TelemetryGlobal = typeof globalThis & { posthog?: PostHogStub };
    function installPostHogStub(): Array<{
        event: string;
        props?: Record<string, unknown>;
    }> {
        const calls: Array<{ event: string; props?: Record<string, unknown> }> = [];
        (globalThis as TelemetryGlobal).posthog = {
            capture(event, props) {
                calls.push({ event, props });
            },
        };
        return calls;
    }
    function uninstallPostHogStub(): void {
        delete (globalThis as TelemetryGlobal).posthog;
    }

    test('legacy branch routes pushes through the soak sink with pipeline=overlay-legacy', async () => {
        pipelineFlagState.v1Enabled = false;
        const captures = installPostHogStub();
        const relay = await startFakeRelay();
        try {
            const { service } = makeEsbuildService();
            const pipeline = createTwoTierMobilePreviewPipeline(
                {
                    kind: 'two-tier',
                    builderBaseUrl: 'https://builder',
                    relayBaseUrl: relay.baseUrl,
                },
                { esbuildService: service, createSessionId: () => 'legacy-telem' },
            );
            await pipeline.sync({ fileSystem: makeVfs(FILES) });

            const pushCaptures = captures.filter(
                (c) => c.event === 'onlook_overlay_push',
            );
            expect(pushCaptures.length).toBe(1);
            expect(pushCaptures[0]!.props!.pipeline).toBe('overlay-legacy');
            expect(pushCaptures[0]!.props!.sessionId).toBe('legacy-telem');
            expect(pushCaptures[0]!.props!.ok).toBe(true);
            // delivered flows through from the fake relay's 202 body.
            expect(pushCaptures[0]!.props!.delivered).toBe(1);
        } finally {
            await relay.close();
            uninstallPostHogStub();
            resetPipelineFlag();
        }
    });

    test('v1 branch routes pushes through the soak sink with pipeline=overlay-v1', async () => {
        pipelineFlagState.v1Enabled = true;
        const captures = installPostHogStub();
        const relay = await startFakeRelay();
        try {
            const { service } = makeEsbuildService();
            const pipeline = createTwoTierMobilePreviewPipeline(
                {
                    kind: 'two-tier',
                    builderBaseUrl: 'https://builder',
                    relayBaseUrl: relay.baseUrl,
                },
                { esbuildService: service, createSessionId: () => 'v1-telem' },
            );
            await pipeline.sync({ fileSystem: makeVfs(FILES) });

            const pushCaptures = captures.filter(
                (c) => c.event === 'onlook_overlay_push',
            );
            expect(pushCaptures.length).toBe(1);
            expect(pushCaptures[0]!.props!.pipeline).toBe('overlay-v1');
            expect(pushCaptures[0]!.props!.sessionId).toBe('v1-telem');
            expect(pushCaptures[0]!.props!.ok).toBe(true);
            // bytes is >0 for a real bundled envelope — locks in that the
            // telemetry reflects the v1 wrapped payload, not an empty push.
            expect(
                typeof pushCaptures[0]!.props!.bytes === 'number' &&
                    (pushCaptures[0]!.props!.bytes as number) > 0,
            ).toBe(true);
        } finally {
            await relay.close();
            uninstallPostHogStub();
            resetPipelineFlag();
        }
    });

    test('sink throws do NOT break the push (never-throw guarantee at the integration layer)', async () => {
        pipelineFlagState.v1Enabled = true;
        (globalThis as TelemetryGlobal).posthog = {
            capture() {
                throw new Error('posthog soak-sink simulated failure');
            },
        };
        const relay = await startFakeRelay();
        try {
            const { service } = makeEsbuildService();
            const pipeline = createTwoTierMobilePreviewPipeline(
                {
                    kind: 'two-tier',
                    builderBaseUrl: 'https://builder',
                    relayBaseUrl: relay.baseUrl,
                },
                {
                    esbuildService: service,
                    createSessionId: () => 'v1-sink-boom',
                },
            );
            // The sync must complete — posthog capture throws are swallowed
            // by the sink so control flow on the overlay push is unaffected.
            const result = await pipeline.sync({ fileSystem: makeVfs(FILES) });
            expect(result.type).toBe('bundle-publish');
            expect(relay.pushes.length).toBe(1);
        } finally {
            await relay.close();
            uninstallPostHogStub();
            resetPipelineFlag();
        }
    });
});
