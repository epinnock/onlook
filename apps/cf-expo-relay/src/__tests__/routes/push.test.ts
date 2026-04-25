/// <reference types="bun" />
/**
 * Unit tests for the worker's two-tier overlay routes (POST /push/:id and
 * WS /hmr/:id). The tests stub the HMR_SESSION DO namespace so we can
 * observe request forwarding without booting a real DO.
 */
import { beforeAll, describe, expect, mock, test } from 'bun:test';

mock.module('cloudflare:workers', () => ({
    DurableObject: class {
        protected ctx: unknown;
        protected env: unknown;
        constructor(ctx: unknown, env: unknown) {
            this.ctx = ctx;
            this.env = env;
        }
    },
}));

type WorkerModule = typeof import('../../worker');
type Env = import('../../worker').Env;

let worker: WorkerModule['default'];

beforeAll(async () => {
    const mod: WorkerModule = await import('../../worker');
    worker = mod.default;
});

interface ForwardedCall {
    url: string;
    method: string;
    upgrade: string | null;
    body?: string;
}

interface HmrStubResult {
    namespace: NonNullable<Env['HMR_SESSION']>;
    calls: ForwardedCall[];
    /** Session ids requested via `idFromName`. Useful for asserting routing. */
    idFromNameCalls: string[];
}

function makeHmrStub(response?: () => Response): HmrStubResult {
    const calls: ForwardedCall[] = [];
    const idFromNameCalls: string[] = [];
    const stub = {
        fetch: async (req: Request): Promise<Response> => {
            calls.push({
                url: req.url,
                method: req.method,
                upgrade: req.headers.get('Upgrade'),
                body: req.method === 'POST' ? await req.text() : undefined,
            });
            return response ? response() : new Response('hmr-stub-ok', { status: 202 });
        },
    };
    const namespace = {
        idFromName: (name: string) => {
            idFromNameCalls.push(name);
            return { name } as unknown as DurableObjectId;
        },
        get: (_id: DurableObjectId) => stub as unknown as DurableObjectStub,
    } as unknown as NonNullable<Env['HMR_SESSION']>;

    return {
        namespace,
        get calls() {
            return calls;
        },
        get idFromNameCalls() {
            return idFromNameCalls;
        },
    };
}

function makeExpoSessionStub(): Env['EXPO_SESSION'] {
    const stub = {
        fetch: async () => new Response('expo-stub-ok', { status: 200 }),
    };
    return {
        idFromName: () => ({}) as DurableObjectId,
        get: () => stub as unknown as DurableObjectStub,
    } as unknown as Env['EXPO_SESSION'];
}

function makeEnv(
    overrides: { hmr?: Env['HMR_SESSION']; allowedOrigins?: string } = {},
): Env {
    return {
        BUNDLES: {} as KVNamespace,
        EXPO_SESSION: makeExpoSessionStub(),
        HMR_SESSION: overrides.hmr,
        ESM_CACHE_URL: 'https://cf-esm-cache.dev.workers.dev',
        ALLOWED_PUSH_ORIGINS: overrides.allowedOrigins,
    };
}

async function dispatch(request: Request, env: Env): Promise<Response> {
    if (!worker.fetch) {
        throw new Error('worker.fetch is missing');
    }
    return worker.fetch(request, env);
}

describe('worker POST /push/:sessionId', () => {
    test('forwards to HmrSession DO as POST /push and returns the DO response', async () => {
        const hmr = makeHmrStub();
        const env = makeEnv({ hmr: hmr.namespace });
        const payload = JSON.stringify({ type: 'overlay', code: 'x=1' });

        const response = await dispatch(
            new Request('https://expo-relay.dev.workers.dev/push/my-session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: payload,
            }),
            env,
        );

        expect(response.status).toBe(202);
        expect(hmr.idFromNameCalls).toEqual(['my-session']);
        expect(hmr.calls).toHaveLength(1);
        const forwarded = hmr.calls[0]!;
        expect(forwarded.method).toBe('POST');
        expect(new URL(forwarded.url).pathname).toBe('/push');
        expect(forwarded.body).toBe(payload);
    });

    test('rejects session ids that fail the URL-safe charset with 400', async () => {
        const hmr = makeHmrStub();
        const env = makeEnv({ hmr: hmr.namespace });

        const response = await dispatch(
            new Request('https://expo-relay.dev.workers.dev/push/has%20space', {
                method: 'POST',
                body: '{}',
            }),
            env,
        );

        expect(response.status).toBe(400);
        // DO must not have been invoked for a rejected id.
        expect(hmr.calls).toHaveLength(0);
    });

    test('returns 503 when HMR_SESSION binding is missing', async () => {
        const env = makeEnv();
        const response = await dispatch(
            new Request('https://expo-relay.dev.workers.dev/push/my-session', {
                method: 'POST',
                body: '{}',
            }),
            env,
        );
        expect(response.status).toBe(503);
    });

    test('GET /push/:id returns 404 (push is POST-only)', async () => {
        const hmr = makeHmrStub();
        const env = makeEnv({ hmr: hmr.namespace });
        const response = await dispatch(
            new Request('https://expo-relay.dev.workers.dev/push/my-session'),
            env,
        );
        expect(response.status).toBe(404);
        expect(hmr.calls).toHaveLength(0);
    });
});

describe('worker /push CORS', () => {
    test('OPTIONS preflight returns 204 with CORS headers when origin is allowed', async () => {
        const hmr = makeHmrStub();
        const env = makeEnv({
            hmr: hmr.namespace,
            allowedOrigins: 'https://editor.onlook.com,http://localhost:3000',
        });
        const response = await dispatch(
            new Request('https://expo-relay.dev.workers.dev/push/my-session', {
                method: 'OPTIONS',
                headers: { Origin: 'https://editor.onlook.com' },
            }),
            env,
        );
        expect(response.status).toBe(204);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://editor.onlook.com');
        expect(response.headers.get('Access-Control-Allow-Methods')).toContain('POST');
        expect(response.headers.get('Access-Control-Allow-Headers')).toContain('Content-Type');
        // Preflight must not hit the DO.
        expect(hmr.calls).toHaveLength(0);
    });

    test('OPTIONS preflight omits CORS headers when origin is not in the allowlist', async () => {
        const hmr = makeHmrStub();
        const env = makeEnv({
            hmr: hmr.namespace,
            allowedOrigins: 'https://editor.onlook.com',
        });
        const response = await dispatch(
            new Request('https://expo-relay.dev.workers.dev/push/my-session', {
                method: 'OPTIONS',
                headers: { Origin: 'https://evil.example.com' },
            }),
            env,
        );
        expect(response.status).toBe(204);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    });

    test('OPTIONS preflight reflects any Origin when ALLOWED_PUSH_ORIGINS is unset (dev default)', async () => {
        const hmr = makeHmrStub();
        const env = makeEnv({ hmr: hmr.namespace });
        const response = await dispatch(
            new Request('https://expo-relay.dev.workers.dev/push/my-session', {
                method: 'OPTIONS',
                headers: { Origin: 'http://127.0.0.1:5173' },
            }),
            env,
        );
        expect(response.status).toBe(204);
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('http://127.0.0.1:5173');
    });

    test('POST response includes Access-Control-Allow-Origin when allowed', async () => {
        const hmr = makeHmrStub();
        const env = makeEnv({
            hmr: hmr.namespace,
            allowedOrigins: 'https://editor.onlook.com',
        });
        const response = await dispatch(
            new Request('https://expo-relay.dev.workers.dev/push/my-session', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Origin: 'https://editor.onlook.com',
                },
                body: JSON.stringify({ type: 'overlay', code: 'x' }),
            }),
            env,
        );
        expect(response.headers.get('Access-Control-Allow-Origin')).toBe('https://editor.onlook.com');
        expect(response.headers.get('Vary')).toBe('Origin');
    });

    test('POST without Origin header has no CORS headers (same-origin / non-browser client)', async () => {
        const hmr = makeHmrStub();
        const env = makeEnv({ hmr: hmr.namespace });
        const response = await dispatch(
            new Request('https://expo-relay.dev.workers.dev/push/my-session', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ type: 'overlay', code: 'x' }),
            }),
            env,
        );
        expect(response.headers.get('Access-Control-Allow-Origin')).toBeNull();
    });
});

describe('worker WS /hmr/:sessionId', () => {
    test('forwards websocket upgrade to HmrSession DO as /', async () => {
        const hmr = makeHmrStub(() => new Response(null, { status: 101 }));
        const env = makeEnv({ hmr: hmr.namespace });

        const response = await dispatch(
            new Request('https://expo-relay.dev.workers.dev/hmr/my-session', {
                headers: { Upgrade: 'websocket' },
            }),
            env,
        );

        expect(response.status).toBe(101);
        expect(hmr.idFromNameCalls).toEqual(['my-session']);
        expect(hmr.calls).toHaveLength(1);
        const forwarded = hmr.calls[0]!;
        expect(forwarded.upgrade?.toLowerCase()).toBe('websocket');
        expect(new URL(forwarded.url).pathname).toBe('/');
    });

    test('GET /hmr/:id without Upgrade header falls through to 404', async () => {
        const hmr = makeHmrStub();
        const env = makeEnv({ hmr: hmr.namespace });

        const response = await dispatch(
            new Request('https://expo-relay.dev.workers.dev/hmr/my-session'),
            env,
        );
        expect(response.status).toBe(404);
        expect(hmr.calls).toHaveLength(0);
    });

    test('WS upgrade to /hmr/:id returns 503 when HMR_SESSION binding is missing', async () => {
        const env = makeEnv();
        const response = await dispatch(
            new Request('https://expo-relay.dev.workers.dev/hmr/my-session', {
                headers: { Upgrade: 'websocket' },
            }),
            env,
        );
        expect(response.status).toBe(503);
    });

    test('WS upgrade with an invalid session id returns 400', async () => {
        const hmr = makeHmrStub();
        const env = makeEnv({ hmr: hmr.namespace });

        const response = await dispatch(
            new Request('https://expo-relay.dev.workers.dev/hmr/has%20space', {
                headers: { Upgrade: 'websocket' },
            }),
            env,
        );

        expect(response.status).toBe(400);
        expect(hmr.calls).toHaveLength(0);
    });
});
