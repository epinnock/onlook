/// <reference types="bun" />
/**
 * Tests for the `BuildSession` Durable Object (TH2.2).
 *
 * The DO is exercised directly — no Cloudflare runtime, no real R2. We mock
 * `DurableObjectState` with an in-memory Map-backed storage and pass a
 * minimal `Env` (no R2 yet; TH2.4 covers the R2 write path).
 */
import { describe, expect, test } from 'bun:test';

import { BuildSession } from '../../do/build-session';
import type { Env } from '../../types';

const FIXED_HASH = 'fixedhash000000000000000000000000000000000000000000000000000000a';
const OTHER_HASH = 'otherhash000000000000000000000000000000000000000000000000000000b';

interface BuildStatusBody {
    state: 'pending' | 'building' | 'ready' | 'failed';
    sourceHash: string;
    bundleHash?: string;
    error?: string;
    builtAt?: string;
    sizeBytes?: number;
}

interface StartResponseBody {
    buildId: string;
    sourceHash: string;
    cached: boolean;
    state: 'pending' | 'building' | 'ready' | 'failed';
}

function makeState(): DurableObjectState {
    const map = new Map<string, unknown>();
    const storage = {
        async get<T>(key: string): Promise<T | undefined> {
            return map.get(key) as T | undefined;
        },
        async put(key: string, value: unknown): Promise<void> {
            map.set(key, value);
        },
        async delete(key: string): Promise<boolean> {
            return map.delete(key);
        },
    };
    // Cast through `unknown` — the real `DurableObjectState` shape is huge
    // (alarms, transactions, blockConcurrencyWhile, …) but the DO under test
    // only touches `storage.get` / `storage.put`.
    return { storage } as unknown as DurableObjectState;
}

function makeEnv(): Env {
    // `BUNDLES` / bindings aren't exercised by TH2.2 — the DO only touches
    // `state.storage` here. Cast through `unknown` so we don't have to
    // fabricate a full R2Bucket / DurableObjectNamespace.
    return {} as unknown as Env;
}

function startRequest(params: {
    sourceHash?: string;
    projectId?: string;
    branchId?: string;
}): Request {
    const url = new URL('https://do.test/start');
    if (params.sourceHash) url.searchParams.set('sourceHash', params.sourceHash);
    if (params.projectId) url.searchParams.set('projectId', params.projectId);
    if (params.branchId) url.searchParams.set('branchId', params.branchId);
    return new Request(url.toString(), { method: 'POST' });
}

function statusRequest(): Request {
    return new Request('https://do.test/status', { method: 'GET' });
}

describe('BuildSession DO', () => {
    test('POST /start with valid params transitions to building', async () => {
        const session = new BuildSession(makeState(), makeEnv());
        const res = await session.fetch(
            startRequest({
                sourceHash: FIXED_HASH,
                projectId: 'proj-1',
                branchId: 'branch-1',
            }),
        );
        expect(res.status).toBe(200);
        const body = (await res.json()) as StartResponseBody;
        expect(body.buildId).toBe(FIXED_HASH);
        expect(body.sourceHash).toBe(FIXED_HASH);
        expect(body.cached).toBe(false);
        expect(body.state).toBe('building');
    });

    test('POST /start without sourceHash returns 400', async () => {
        const session = new BuildSession(makeState(), makeEnv());
        const res = await session.fetch(
            startRequest({ projectId: 'proj-1', branchId: 'branch-1' }),
        );
        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: string };
        expect(body.error).toBe('missing params');
    });

    test('POST /start without projectId returns 400', async () => {
        const session = new BuildSession(makeState(), makeEnv());
        const res = await session.fetch(
            startRequest({ sourceHash: FIXED_HASH, branchId: 'branch-1' }),
        );
        expect(res.status).toBe(400);
    });

    test('POST /start without branchId returns 400', async () => {
        const session = new BuildSession(makeState(), makeEnv());
        const res = await session.fetch(
            startRequest({ sourceHash: FIXED_HASH, projectId: 'proj-1' }),
        );
        expect(res.status).toBe(400);
    });

    test('POST /start is idempotent for the same sourceHash', async () => {
        const session = new BuildSession(makeState(), makeEnv());

        const first = await session.fetch(
            startRequest({
                sourceHash: FIXED_HASH,
                projectId: 'proj-1',
                branchId: 'branch-1',
            }),
        );
        expect(first.status).toBe(200);
        const firstBody = (await first.json()) as StartResponseBody;
        expect(firstBody.state).toBe('building');
        expect(firstBody.cached).toBe(false);

        // Second /start with the same hash should re-issue existing state,
        // not kick a fresh build. `cached` reflects ready-ness; still
        // `false` here because we're still `building`.
        const second = await session.fetch(
            startRequest({
                sourceHash: FIXED_HASH,
                projectId: 'proj-1',
                branchId: 'branch-1',
            }),
        );
        expect(second.status).toBe(200);
        const secondBody = (await second.json()) as StartResponseBody;
        expect(secondBody.sourceHash).toBe(FIXED_HASH);
        expect(secondBody.state).toBe('building');
        expect(secondBody.cached).toBe(false);
    });

    test('POST /start with a different sourceHash overwrites prior state', async () => {
        // A single DO instance is keyed by sourceHash in production, so
        // hitting the same DO with a *different* hash is pathological — but
        // we still want a well-defined outcome: the prior state is
        // overwritten rather than silently ignored.
        const session = new BuildSession(makeState(), makeEnv());

        const first = await session.fetch(
            startRequest({
                sourceHash: FIXED_HASH,
                projectId: 'proj-1',
                branchId: 'branch-1',
            }),
        );
        expect(first.status).toBe(200);

        const second = await session.fetch(
            startRequest({
                sourceHash: OTHER_HASH,
                projectId: 'proj-1',
                branchId: 'branch-1',
            }),
        );
        expect(second.status).toBe(200);
        const secondBody = (await second.json()) as StartResponseBody;
        expect(secondBody.sourceHash).toBe(OTHER_HASH);
        expect(secondBody.state).toBe('building');
    });

    test('GET /status after /start returns building', async () => {
        const session = new BuildSession(makeState(), makeEnv());
        await session.fetch(
            startRequest({
                sourceHash: FIXED_HASH,
                projectId: 'proj-1',
                branchId: 'branch-1',
            }),
        );

        const res = await session.fetch(statusRequest());
        expect(res.status).toBe(200);
        const body = (await res.json()) as BuildStatusBody;
        expect(body.state).toBe('building');
        expect(body.sourceHash).toBe(FIXED_HASH);
        expect(body.bundleHash).toBeUndefined();
        expect(body.error).toBeUndefined();
    });

    test('GET /status with no prior build returns 404', async () => {
        const session = new BuildSession(makeState(), makeEnv());
        const res = await session.fetch(statusRequest());
        expect(res.status).toBe(404);
        const body = (await res.json()) as { error: string };
        expect(body.error).toBe('no build');
    });

    test('unknown pathname returns 404', async () => {
        const session = new BuildSession(makeState(), makeEnv());
        const res = await session.fetch(
            new Request('https://do.test/bogus', { method: 'POST' }),
        );
        expect(res.status).toBe(404);
    });

    test('unsupported method on /start returns 404', async () => {
        const session = new BuildSession(makeState(), makeEnv());
        const res = await session.fetch(
            new Request('https://do.test/start', { method: 'GET' }),
        );
        expect(res.status).toBe(404);
    });

    test('unsupported method on /status returns 404', async () => {
        const session = new BuildSession(makeState(), makeEnv());
        const res = await session.fetch(
            new Request('https://do.test/status', { method: 'POST' }),
        );
        expect(res.status).toBe(404);
    });
});
