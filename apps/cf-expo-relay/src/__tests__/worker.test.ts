/// <reference types="bun" />
/**
 * Unit tests for the cf-expo-relay Worker entrypoint (TQ1.4).
 *
 * We exercise the top-level fetch handler directly with a fake `Env` so we
 * can verify the route table without spinning up Miniflare / Durable Objects.
 * The only piece of `Env` that matters for the `/manifest/:bundleHash` path
 * is the `ESM_CACHE` service binding (TQ1.3) — we stub it so we can assert
 * both that the route fires and that the stub receives the expected upstream
 * URLs. Session / DO routes still need an `EXPO_SESSION` binding, which we
 * stub just enough to observe forwarded requests.
 *
 * `worker.ts` transitively imports `./session.ts`, which imports the
 * Workers-runtime builtin `cloudflare:workers`. Bun cannot resolve that
 * module during `bun test`, so we stub it with a no-op `DurableObject`
 * class before importing the worker. The session DO is not exercised by
 * these tests — the stubbed `EXPO_SESSION` namespace stands in for it — so
 * a bare class is sufficient.
 */
import { beforeAll, describe, expect, mock, test } from 'bun:test';

import type { ManifestFields } from '../manifest-builder';
import type { ServiceBinding } from '../routes/manifest';

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

type WorkerModule = typeof import('../worker');
type Env = import('../worker').Env;

let worker: WorkerModule['default'];

beforeAll(async () => {
    const mod: WorkerModule = await import('../worker');
    worker = mod.default;
});

const VALID_HASH =
    'c6a1fbc03d4e7f1234567890abcdef0123456789abcdef0123456789abcdef01';
const CACHE_URL = 'https://cf-esm-cache.dev.workers.dev';
const FIXED_BUILT_AT = '2026-04-07T21:00:00.000Z';

function baseFields(): ManifestFields {
    return {
        runtimeVersion: '1.0.0',
        launchAsset: {
            key: `bundle-${VALID_HASH}`,
            contentType: 'application/javascript',
        },
        assets: [],
        metadata: {},
        extra: {
            expoClient: {
                name: 'Onlook Preview',
                slug: 'onlook-preview',
                version: '1.0.0',
                sdkVersion: '54.0.0',
                platforms: ['ios', 'android'],
                icon: null,
                splash: { backgroundColor: '#ffffff' },
                newArchEnabled: true,
            },
            scopeKey: '@onlook/preview',
            eas: { projectId: null },
        },
    };
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

interface StubBindingResult {
    binding: ServiceBinding;
    calls: string[];
}

/**
 * Minimal ESM_CACHE stub: serves the manifest-fields / meta pair for the
 * known hash and 404s everything else. Records call order so tests can
 * assert routing.
 */
function makeEsmCacheStub(): StubBindingResult {
    const calls: string[] = [];
    const binding: ServiceBinding = {
        async fetch(request: Request): Promise<Response> {
            calls.push(request.url);
            if (request.url.endsWith('/manifest-fields.json')) {
                return jsonResponse(baseFields());
            }
            if (request.url.endsWith('/meta.json')) {
                return jsonResponse({ builtAt: FIXED_BUILT_AT });
            }
            return new Response('not found', { status: 404 });
        },
    };
    return { binding, calls };
}

/**
 * Very small stand-in for `DurableObjectNamespace` — enough to observe that
 * the worker forwarded a request to a session DO without actually booting
 * one. The session-forwarding tests only assert that the stub was invoked
 * (or wasn't) for a given path.
 */
interface DoStubResult {
    namespace: Env['EXPO_SESSION'];
    forwardedCount: number;
}

function makeExpoSessionStub(): DoStubResult {
    let forwardedCount = 0;
    const stub = {
        fetch: async (_req: Request): Promise<Response> => {
            forwardedCount += 1;
            return new Response('do-stub-ok', { status: 200 });
        },
    };
    // Cast through unknown: we deliberately only implement the two methods
    // the worker uses. Structural mocking of the full DO namespace would
    // add noise without raising coverage.
    const namespace = {
        idFromName: (_name: string) => ({ name: _name }) as unknown as DurableObjectId,
        get: (_id: DurableObjectId) => stub as unknown as DurableObjectStub,
    } as unknown as Env['EXPO_SESSION'];

    return {
        namespace,
        get forwardedCount() {
            return forwardedCount;
        },
    };
}

function makeEnv(overrides: {
    esmCache?: ServiceBinding;
    expoSession?: Env['EXPO_SESSION'];
} = {}): Env {
    return {
        BUNDLES: {} as KVNamespace,
        EXPO_SESSION: overrides.expoSession ?? makeExpoSessionStub().namespace,
        ESM_CACHE: overrides.esmCache,
        ESM_CACHE_URL: CACHE_URL,
    };
}

async function dispatch(request: Request, env: Env): Promise<Response> {
    // The worker module's default export is typed with `satisfies
    // ExportedHandler<Env>`, so `fetch` is technically optional on the type
    // level. We assert presence at the call site. This worker's `fetch`
    // signature takes `(request, env)` only — no `ExecutionContext`.
    if (!worker.fetch) {
        throw new Error('worker.fetch is missing');
    }
    return worker.fetch(request, env);
}

describe('worker fetch route table (TQ1.4)', () => {
    test('GET /manifest/<64-hex> is forwarded to handleManifest via ESM_CACHE binding', async () => {
        const { binding, calls } = makeEsmCacheStub();
        const env = makeEnv({ esmCache: binding });

        const response = await dispatch(
            new Request(`https://expo-relay.dev.workers.dev/manifest/${VALID_HASH}`),
            env,
        );

        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toContain('multipart/mixed');
        expect(response.headers.get('expo-protocol-version')).toBe('0');
        expect(response.headers.get('expo-sfv-version')).toBe('0');
        expect(calls).toContain(
            `${CACHE_URL}/bundle/${VALID_HASH}/manifest-fields.json`,
        );
        expect(calls).toContain(`${CACHE_URL}/bundle/${VALID_HASH}/meta.json`);
    });

    test('GET /manifest/badhash falls through to 404 (router does not match non-hex)', async () => {
        const { binding, calls } = makeEsmCacheStub();
        const env = makeEnv({ esmCache: binding });

        const response = await dispatch(
            new Request('https://expo-relay.dev.workers.dev/manifest/badhash'),
            env,
        );

        expect(response.status).toBe(404);
        expect(await response.text()).toBe('expo-relay: unknown route');
        // The manifest route must never have touched the cache.
        expect(calls).toHaveLength(0);
    });

    test('GET /manifest/<63-hex> (one char short) falls through to 404', async () => {
        const short = VALID_HASH.slice(0, -1);
        const { binding, calls } = makeEsmCacheStub();
        const env = makeEnv({ esmCache: binding });

        const response = await dispatch(
            new Request(`https://expo-relay.dev.workers.dev/manifest/${short}`),
            env,
        );

        expect(response.status).toBe(404);
        expect(calls).toHaveLength(0);
    });

    test('GET /manifest/<UPPERHEX> falls through to 404 (canonical form is lowercase)', async () => {
        const upper = VALID_HASH.toUpperCase();
        const { binding, calls } = makeEsmCacheStub();
        const env = makeEnv({ esmCache: binding });

        const response = await dispatch(
            new Request(`https://expo-relay.dev.workers.dev/manifest/${upper}`),
            env,
        );

        expect(response.status).toBe(404);
        expect(calls).toHaveLength(0);
    });

    test('GET /unknown returns 404 "expo-relay: unknown route"', async () => {
        const env = makeEnv();
        const response = await dispatch(
            new Request('https://expo-relay.dev.workers.dev/unknown'),
            env,
        );
        expect(response.status).toBe(404);
        expect(await response.text()).toBe('expo-relay: unknown route');
    });

    test('GET / returns 404 (empty path does not match any route)', async () => {
        const env = makeEnv();
        const response = await dispatch(
            new Request('https://expo-relay.dev.workers.dev/'),
            env,
        );
        expect(response.status).toBe(404);
    });

    test('legacy GET /session/:id/manifest still forwards to the DO stub', async () => {
        const doStub = makeExpoSessionStub();
        const env = makeEnv({ expoSession: doStub.namespace });

        const response = await dispatch(
            new Request('https://expo-relay.dev.workers.dev/session/abc/manifest'),
            env,
        );

        expect(response.status).toBe(200);
        expect(await response.text()).toBe('do-stub-ok');
        expect(doStub.forwardedCount).toBe(1);
    });

    test('legacy GET /session/:id/bundle.js still forwards to the DO stub', async () => {
        const doStub = makeExpoSessionStub();
        const env = makeEnv({ expoSession: doStub.namespace });

        const response = await dispatch(
            new Request('https://expo-relay.dev.workers.dev/session/abc/bundle.js'),
            env,
        );

        expect(response.status).toBe(200);
        expect(doStub.forwardedCount).toBe(1);
    });

    test('the new /manifest/:hash route does not shadow legacy /session/:id/manifest', async () => {
        // Sanity: the 64-hex regex is anchored on `/manifest/...`, so
        // session paths must not be matched by it even if the session id
        // happens to contain hex characters.
        const doStub = makeExpoSessionStub();
        const { binding, calls } = makeEsmCacheStub();
        const env = makeEnv({ esmCache: binding, expoSession: doStub.namespace });

        const response = await dispatch(
            new Request(`https://expo-relay.dev.workers.dev/session/${VALID_HASH}/manifest`),
            env,
        );

        expect(response.status).toBe(200);
        expect(doStub.forwardedCount).toBe(1);
        // Manifest cache path must be untouched.
        expect(calls).toHaveLength(0);
    });

    test('POST /manifest/<64-hex> returns 404 (route is GET-only)', async () => {
        const { binding, calls } = makeEsmCacheStub();
        const env = makeEnv({ esmCache: binding });

        const response = await dispatch(
            new Request(`https://expo-relay.dev.workers.dev/manifest/${VALID_HASH}`, {
                method: 'POST',
            }),
            env,
        );

        expect(response.status).toBe(404);
        expect(calls).toHaveLength(0);
    });
});
