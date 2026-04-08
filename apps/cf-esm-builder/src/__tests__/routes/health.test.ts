/**
 * Tests for `GET /health` (TH2.4).
 *
 * The handler is pure (input: `Request` + `Env`, output: `Response`) so we
 * exercise it directly with plain object literals — no Workers runtime, no
 * miniflare, no network. The `Env` mock is cast through `unknown` because
 * the production type requires a `DurableObjectNamespace` for `ESM_BUILDER`
 * that the health probe never touches.
 */
import { describe, expect, it } from 'bun:test';
import { handleHealth } from '../../routes/health';
import type { Env, HealthResponse } from '../../types';

const EXPECTED_VERSION = '0.1.0';

function makeEnv(overrides: Partial<Env> = {}): Env {
    return {
        ESM_BUILDER: {} as DurableObjectNamespace,
        BUILD_SESSION: {} as DurableObjectNamespace,
        BUNDLES: {} as R2Bucket,
        ...overrides,
    };
}

function makeRequest(): Request {
    return new Request('https://builder.example.com/health');
}

describe('GET /health', () => {
    it('returns ok=true with the module version and container=missing when no CONTAINER binding is set', async () => {
        const res = await handleHealth(makeRequest(), makeEnv());

        expect(res.status).toBe(200);
        const body = (await res.json()) as HealthResponse;
        expect(body).toEqual({
            ok: true,
            version: EXPECTED_VERSION,
            container: 'missing',
        });
    });

    it('reports container=ready when env.CONTAINER is bound (truthy)', async () => {
        const env = makeEnv({ CONTAINER: { idFromName: () => 'noop' } });
        const res = await handleHealth(makeRequest(), env);

        const body = (await res.json()) as HealthResponse;
        expect(body.container).toBe('ready');
        expect(body.ok).toBe(true);
        expect(body.version).toBe(EXPECTED_VERSION);
    });

    it('treats an empty-object CONTAINER binding as ready (presence, not shape)', async () => {
        const env = makeEnv({ CONTAINER: {} });
        const res = await handleHealth(makeRequest(), env);

        const body = (await res.json()) as HealthResponse;
        expect(body.container).toBe('ready');
    });

    it('treats CONTAINER=null as missing', async () => {
        const env = makeEnv({ CONTAINER: null });
        const res = await handleHealth(makeRequest(), env);

        const body = (await res.json()) as HealthResponse;
        expect(body.container).toBe('missing');
    });

    it('sets Cache-Control: no-cache, no-store', async () => {
        const res = await handleHealth(makeRequest(), makeEnv());
        expect(res.headers.get('Cache-Control')).toBe('no-cache, no-store');
    });

    it('responds with application/json content-type', async () => {
        const res = await handleHealth(makeRequest(), makeEnv());
        const contentType = res.headers.get('Content-Type') ?? '';
        expect(contentType.toLowerCase()).toContain('application/json');
    });

    it('returns HTTP 200 in both ready and missing states', async () => {
        const missing = await handleHealth(makeRequest(), makeEnv());
        const ready = await handleHealth(makeRequest(), makeEnv({ CONTAINER: {} }));

        expect(missing.status).toBe(200);
        expect(ready.status).toBe(200);
    });
});
