/**
 * Tests for BuilderClient (TH4.3). A stubbed fetcher lets us exercise
 * URL construction, headers, error handling, and waitForBuild polling
 * without network I/O.
 */

import { describe, expect, test } from 'bun:test';

import { BuilderClient, BuilderClientError, type Fetcher } from '../client';
import type { BuildResponse, BuildStatus } from '../types';

interface FakeCall {
    url: string;
    init?: RequestInit;
}

function makeJsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function makeTextResponse(body: string, status: number): Response {
    return new Response(body, { status });
}

function immediateSleep(_ms: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) {
        return Promise.reject(signal.reason ?? new Error('aborted'));
    }
    return Promise.resolve();
}

describe('BuilderClient.postSource', () => {
    test('sends tar body with the right headers', async () => {
        const calls: FakeCall[] = [];
        const fetcher: Fetcher = async (input, init) => {
            calls.push({
                url: typeof input === 'string' ? input : input.toString(),
                init,
            });
            return makeJsonResponse({
                buildId: 'abc',
                sourceHash: 'abc',
                cached: false,
            } satisfies BuildResponse);
        };
        const client = new BuilderClient({
            baseUrl: 'http://localhost:8788/',
            fetcher,
        });
        const tar = new Uint8Array([1, 2, 3]).buffer;
        const res = await client.postSource(tar, 'proj', 'branch');
        expect(res.buildId).toBe('abc');
        expect(calls).toHaveLength(1);
        expect(calls[0]!.url).toBe('http://localhost:8788/build');
        expect(calls[0]!.init?.method).toBe('POST');
        const headers = calls[0]!.init?.headers as Record<string, string>;
        expect(headers['Content-Type']).toBe('application/x-tar');
        expect(headers['X-Project-Id']).toBe('proj');
        expect(headers['X-Branch-Id']).toBe('branch');
        expect(calls[0]!.init?.body).toBe(tar);
    });

    test('returns parsed JSON on 200', async () => {
        const fetcher: Fetcher = async () =>
            makeJsonResponse({
                buildId: 'build-1',
                sourceHash: 'hash-1',
                cached: true,
            } satisfies BuildResponse);
        const client = new BuilderClient({ baseUrl: 'http://x', fetcher });
        const res = await client.postSource(new ArrayBuffer(0), 'p', 'b');
        expect(res.cached).toBe(true);
        expect(res.sourceHash).toBe('hash-1');
    });

    test('throws BuilderClientError on 4xx with status + body', async () => {
        const fetcher: Fetcher = async () =>
            makeTextResponse('bad tar', 400);
        const client = new BuilderClient({ baseUrl: 'http://x', fetcher });
        try {
            await client.postSource(new ArrayBuffer(0), 'p', 'b');
            throw new Error('expected throw');
        } catch (err) {
            expect(err).toBeInstanceOf(BuilderClientError);
            const be = err as BuilderClientError;
            expect(be.status).toBe(400);
            expect(be.body).toBe('bad tar');
        }
    });
});

describe('BuilderClient.getStatus', () => {
    test('builds the right URL and returns parsed body', async () => {
        const calls: FakeCall[] = [];
        const fetcher: Fetcher = async (input) => {
            calls.push({ url: typeof input === 'string' ? input : input.toString() });
            return makeJsonResponse({
                state: 'ready',
                sourceHash: 'h',
                bundleHash: 'b',
            } satisfies BuildStatus);
        };
        const client = new BuilderClient({ baseUrl: 'http://x/', fetcher });
        const status = await client.getStatus('bid with space');
        expect(status.state).toBe('ready');
        expect(calls[0]!.url).toBe('http://x/build/bid%20with%20space');
    });
});

describe('BuilderClient.waitForBuild', () => {
    test('polls until ready and emits onUpdate for each poll', async () => {
        const sequence: BuildStatus[] = [
            { state: 'pending', sourceHash: 'h' },
            { state: 'building', sourceHash: 'h' },
            { state: 'ready', sourceHash: 'h', bundleHash: 'bh' },
        ];
        let i = 0;
        const fetcher: Fetcher = async () => makeJsonResponse(sequence[i++]);
        const client = new BuilderClient({ baseUrl: 'http://x', fetcher });

        const seen: BuildStatus[] = [];
        const final = await client.waitForBuild('bid', {
            onUpdate: (s) => seen.push(s),
            sleep: immediateSleep,
            initialPollMs: 1,
            maxPollMs: 2,
        });
        expect(final.state).toBe('ready');
        expect(seen).toHaveLength(3);
        expect(seen.map((s) => s.state)).toEqual(['pending', 'building', 'ready']);
    });

    test('resolves on failed terminal state', async () => {
        const fetcher: Fetcher = async () =>
            makeJsonResponse({
                state: 'failed',
                sourceHash: 'h',
                error: 'boom',
            } satisfies BuildStatus);
        const client = new BuilderClient({ baseUrl: 'http://x', fetcher });
        const status = await client.waitForBuild('bid', { sleep: immediateSleep });
        expect(status.state).toBe('failed');
        expect(status.error).toBe('boom');
    });

    test('aborts when the provided AbortSignal fires mid-poll', async () => {
        const fetcher: Fetcher = async () =>
            makeJsonResponse({
                state: 'building',
                sourceHash: 'h',
            } satisfies BuildStatus);
        const client = new BuilderClient({ baseUrl: 'http://x', fetcher });
        const controller = new AbortController();
        const sleep = (_ms: number, signal?: AbortSignal): Promise<void> => {
            // Abort before we resolve the sleep so the loop bails.
            controller.abort(new Error('user cancelled'));
            if (signal?.aborted) {
                return Promise.reject(signal.reason ?? new Error('aborted'));
            }
            return Promise.resolve();
        };
        try {
            await client.waitForBuild('bid', {
                signal: controller.signal,
                sleep,
                initialPollMs: 1,
            });
            throw new Error('expected throw');
        } catch (err) {
            expect(err instanceof Error ? err.message : '').toContain('user cancelled');
        }
    });

    test('throws on timeout', async () => {
        let realTime = 0;
        const originalNow = Date.now;
        // Drive Date.now forward so the timeout guard fires.
        // eslint-disable-next-line @typescript-eslint/unbound-method
        Date.now = () => realTime;
        try {
            const fetcher: Fetcher = async () => {
                realTime += 100;
                return makeJsonResponse({
                    state: 'building',
                    sourceHash: 'h',
                } satisfies BuildStatus);
            };
            const client = new BuilderClient({ baseUrl: 'http://x', fetcher });
            try {
                await client.waitForBuild('bid', {
                    sleep: immediateSleep,
                    initialPollMs: 1,
                    maxPollMs: 2,
                    timeoutMs: 50,
                });
                throw new Error('expected timeout');
            } catch (err) {
                expect(err).toBeInstanceOf(BuilderClientError);
                expect((err as BuilderClientError).message).toContain('timed out');
            }
        } finally {
            Date.now = originalNow;
        }
    });
});

describe('BuilderClient.health', () => {
    test('returns { ok: true } on 200', async () => {
        const fetcher: Fetcher = async () =>
            makeJsonResponse({ ok: true, version: '1', container: 'ready' });
        const client = new BuilderClient({ baseUrl: 'http://x', fetcher });
        const res = await client.health();
        expect(res.ok).toBe(true);
    });

    test('returns { ok: false } on 500', async () => {
        const fetcher: Fetcher = async () => makeTextResponse('nope', 500);
        const client = new BuilderClient({ baseUrl: 'http://x', fetcher });
        expect((await client.health()).ok).toBe(false);
    });

    test('returns { ok: false } on fetch throw', async () => {
        const fetcher: Fetcher = async () => {
            throw new Error('network down');
        };
        const client = new BuilderClient({ baseUrl: 'http://x', fetcher });
        expect((await client.health()).ok).toBe(false);
    });
});
