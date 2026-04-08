/**
 * Tests for BuildOrchestrator (TH4.4). The orchestrator is a thin glue
 * layer — we stub the BuilderClient and CodeFileSystem seams and assert
 * the call order + error propagation.
 */

import { describe, expect, test } from 'bun:test';

import type { CodeFileSystem } from '@onlook/file-system';

import { BuildOrchestrator } from '../build-orchestrator';
import { BuilderClient, type Fetcher } from '../client';
import type { BuildResponse, BuildStatus } from '../types';

function fakeFs(): CodeFileSystem {
    const fake = {
        async listAll(): Promise<Array<{ path: string; type: 'file' | 'directory' }>> {
            return [
                { path: '/package.json', type: 'file' },
                { path: '/src/app.tsx', type: 'file' },
            ];
        },
        async readFile(p: string): Promise<string> {
            if (p === '/package.json') return '{"name":"fixture"}';
            if (p === '/src/app.tsx') return 'export default () => null;\n';
            throw new Error(`unexpected ${p}`);
        },
    };
    return fake as unknown as CodeFileSystem;
}

interface MockCallLog {
    postSource: Array<{ projectId: string; branchId: string; tarSize: number }>;
    getStatus: string[];
}

function makeMockClient(
    statuses: BuildStatus[],
    postResponse: BuildResponse = {
        buildId: 'build-123',
        sourceHash: 'src-123',
        cached: false,
    },
    options: { throwOnPost?: Error } = {},
): { client: BuilderClient; calls: MockCallLog } {
    const calls: MockCallLog = { postSource: [], getStatus: [] };
    let idx = 0;
    const fetcher: Fetcher = async (input, init) => {
        const url = typeof input === 'string' ? input : input.toString();
        if (url.endsWith('/build') && init?.method === 'POST') {
            if (options.throwOnPost) {
                return new Response(options.throwOnPost.message, { status: 500 });
            }
            const body = init.body as ArrayBuffer;
            const headers = init.headers as Record<string, string>;
            calls.postSource.push({
                projectId: headers['X-Project-Id']!,
                branchId: headers['X-Branch-Id']!,
                tarSize: body.byteLength,
            });
            return new Response(JSON.stringify(postResponse), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }
        if (url.includes('/build/')) {
            const id = url.split('/build/')[1]!;
            calls.getStatus.push(id);
            const status = statuses[Math.min(idx, statuses.length - 1)];
            idx++;
            return new Response(JSON.stringify(status), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        }
        return new Response('not found', { status: 404 });
    };
    const client = new BuilderClient({ baseUrl: 'http://mock', fetcher });
    return { client, calls };
}

describe('BuildOrchestrator.build', () => {
    test('calls createSourceTar, postSource, waitForBuild in order', async () => {
        const { client, calls } = makeMockClient([
            { state: 'pending', sourceHash: 'src-123' },
            { state: 'building', sourceHash: 'src-123' },
            { state: 'ready', sourceHash: 'src-123', bundleHash: 'bh' },
        ]);

        const seen: BuildStatus[] = [];
        const orch = new BuildOrchestrator({
            fs: fakeFs(),
            client,
            projectId: 'proj',
            branchId: 'branch',
            onStatusChange: (s) => seen.push(s),
        });
        // Patch waitForBuild to use a sleep-free override via an unused
        // fast path: the real client polls with defaultSleep, which would
        // add up to ~1s of latency across the sequence. Instead we stub
        // the client method directly for timing.
        const originalWait = client.waitForBuild.bind(client);
        client.waitForBuild = (buildId, opts) =>
            originalWait(buildId, {
                ...opts,
                sleep: async () => undefined,
                initialPollMs: 0,
                maxPollMs: 1,
            });

        const final = await orch.build();
        expect(final.state).toBe('ready');
        expect(final.bundleHash).toBe('bh');
        expect(calls.postSource).toHaveLength(1);
        expect(calls.postSource[0]!.projectId).toBe('proj');
        expect(calls.postSource[0]!.branchId).toBe('branch');
        expect(calls.postSource[0]!.tarSize).toBeGreaterThan(1024);
        expect(calls.getStatus.length).toBeGreaterThanOrEqual(1);
        // onStatusChange fires at least once per poll + once on final.
        expect(seen.length).toBeGreaterThanOrEqual(3);
        expect(seen[seen.length - 1]!.state).toBe('ready');
    });

    test('returns the final status from build()', async () => {
        const { client } = makeMockClient([
            { state: 'ready', sourceHash: 'abc', bundleHash: 'def', bundleSize: 42 },
        ]);
        const orch = new BuildOrchestrator({
            fs: fakeFs(),
            client,
            projectId: 'p',
            branchId: 'b',
        });
        const final = await orch.build();
        expect(final.bundleHash).toBe('def');
        expect(final.bundleSize).toBe(42);
    });

    test('propagates errors from postSource', async () => {
        const { client } = makeMockClient(
            [{ state: 'pending', sourceHash: '' }],
            { buildId: '', sourceHash: '', cached: false },
            { throwOnPost: new Error('upload rejected') },
        );
        const orch = new BuildOrchestrator({
            fs: fakeFs(),
            client,
            projectId: 'p',
            branchId: 'b',
        });
        try {
            await orch.build();
            throw new Error('expected throw');
        } catch (err) {
            expect(err instanceof Error ? err.message : '').toContain('postSource failed');
        }
        expect(orch.getStatus()).toBeNull();
    });

    test('getStatus returns the latest status after build()', async () => {
        const { client } = makeMockClient([
            { state: 'ready', sourceHash: 'h', bundleHash: 'bh' },
        ]);
        const orch = new BuildOrchestrator({
            fs: fakeFs(),
            client,
            projectId: 'p',
            branchId: 'b',
        });
        expect(orch.getStatus()).toBeNull();
        await orch.build();
        const s = orch.getStatus();
        expect(s?.state).toBe('ready');
        expect(s?.bundleHash).toBe('bh');
    });

    test('dispose() prevents further build() calls', async () => {
        const { client } = makeMockClient([
            { state: 'ready', sourceHash: 'h' },
        ]);
        const orch = new BuildOrchestrator({
            fs: fakeFs(),
            client,
            projectId: 'p',
            branchId: 'b',
        });
        orch.dispose();
        try {
            await orch.build();
            throw new Error('expected throw');
        } catch (err) {
            expect(err instanceof Error ? err.message : '').toContain('disposed');
        }
    });
});
