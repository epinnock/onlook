/// <reference types="bun" />
/**
 * Tests for the `cf-esm-builder` Worker entry point (TH2.6).
 *
 * The default export of `worker.ts` is a hand-rolled router that dispatches
 * to the three route handlers in `./routes/*`. These tests exercise the
 * *real* handlers with a minimal stub `Env` so the router's routing
 * decisions (path + method matching, error handling) are observable via
 * each handler's distinctive response.
 *
 * Why no `mock.module` on the route handlers: Bun's module mocks are
 * process-global and keyed by resolved path, so stubbing `./routes/health`
 * from this file would bleed into `routes/health.test.ts` in the same test
 * run and break the other suites. Running the real handlers keeps the
 * tests hermetic and doubles as a tiny integration test.
 *
 * The one mock we *do* need is `cloudflare:workers`, because it is a
 * Workers-runtime builtin that Bun cannot resolve during `bun test`. A
 * no-op `DurableObject` class is enough for the `EsmBuilder` re-export to
 * compile and run.
 */
import { beforeAll, describe, expect, mock, test } from 'bun:test';

import type { Env } from '../types';

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

let workerMod: WorkerModule;

beforeAll(async () => {
    workerMod = (await import('../worker')) as WorkerModule;
});

/**
 * A minimal stub `Env`. The handlers reach into:
 *   - `BUNDLES.head` (build + bundle routes)
 *   - `BUNDLES.get`  (bundle route)
 *   - `BUILD_SESSION.idFromName` / `.get().fetch()` (build route)
 *
 * We stub all of them to return `null` / throw so that each route returns
 * its own distinctive error status (not a router 404), which is what we
 * assert on.
 */
function makeEnv(): Env {
    const emptyBucket = {
        async head(): Promise<null> {
            return null;
        },
        async get(): Promise<null> {
            return null;
        },
    } as unknown as R2Bucket;

    const missingNamespace = {
        idFromName(): never {
            throw new Error('stub: no build session');
        },
        get(): never {
            throw new Error('stub: no build session');
        },
    } as unknown as DurableObjectNamespace;

    return {
        ESM_BUILDER: missingNamespace,
        BUILD_SESSION: missingNamespace,
        BUNDLES: emptyBucket,
    };
}

function invoke(request: Request): Promise<Response> {
    // The real signature includes `ctx: ExecutionContext` but the hand-rolled
    // router never reads it; a cast-through-unknown keeps the test free of
    // `any` while matching the production call site.
    const handler = workerMod.default.fetch as (req: Request, env: Env) => Promise<Response>;
    return handler(request, makeEnv());
}

function isRouterNotFound(res: Response): Promise<boolean> {
    // The router itself returns a plain-text 404 with body "not found"
    // (lowercase) so we can distinguish it from any handler-originated 404
    // ("Not Found" in the bundle route, JSON bodies elsewhere).
    if (res.status !== 404) return Promise.resolve(false);
    return res
        .clone()
        .text()
        .then((t) => t === 'not found');
}

describe('cf-esm-builder worker router', () => {
    test('GET /health dispatches to handleHealth and returns the real health body', async () => {
        const res = await invoke(new Request('https://builder.example.com/health'));

        expect(res.status).toBe(200);
        expect(res.headers.get('Content-Type') ?? '').toContain('application/json');
        const body = (await res.json()) as {
            ok: boolean;
            version: string;
            container: string;
        };
        expect(body.ok).toBe(true);
        // `version` and `container` are fixed by TH2.4. We only assert they
        // exist so future version bumps don't churn this test.
        expect(typeof body.version).toBe('string');
        expect(['ready', 'missing']).toContain(body.container);
    });

    test('POST /build dispatches to handleBuild (reaches handler-level content-type validation)', async () => {
        // No Content-Type header → handleBuild returns 400 'unsupported
        // content-type'. A 404 here would mean the router didn't dispatch.
        const res = await invoke(
            new Request('https://builder.example.com/build', { method: 'POST' }),
        );

        expect(res.status).toBe(400);
        const body = (await res.json()) as { error: string };
        expect(body.error).toBe('unsupported content-type');
    });

    test('GET /bundle/<hash> dispatches to handleBundle (returns handler 404, not router 404)', async () => {
        const res = await invoke(
            new Request(
                'https://builder.example.com/bundle/c6a1fbc03d4e7f1234567890abcdef0123456789abcdef0123456789abcdef01',
            ),
        );

        // handleBundle returns the title-cased body "Not Found" when R2 is
        // empty; the router's fallthrough returns lowercase "not found". We
        // assert on the exact text to prove dispatch.
        expect(res.status).toBe(404);
        expect(await res.text()).toBe('Not Found');
        expect(await isRouterNotFound(res.clone())).toBe(false);
    });

    test('GET /bundle/<hash>/<file> dispatches to handleBundle (nested path)', async () => {
        const res = await invoke(
            new Request('https://builder.example.com/bundle/abcdef/meta.json'),
        );

        expect(res.status).toBe(404);
        expect(await res.text()).toBe('Not Found');
    });

    test('HEAD /bundle/<hash> dispatches to handleBundle', async () => {
        const res = await invoke(
            new Request('https://builder.example.com/bundle/abcdef', { method: 'HEAD' }),
        );

        // Same handler path as GET; returns 404 because BUNDLES is empty.
        expect(res.status).toBe(404);
    });

    test('GET /unknown returns the router 404 (plain "not found")', async () => {
        const res = await invoke(new Request('https://builder.example.com/unknown'));

        expect(res.status).toBe(404);
        expect(await res.text()).toBe('not found');
    });

    test('GET / returns 404 (root is not a route)', async () => {
        const res = await invoke(new Request('https://builder.example.com/'));

        expect(res.status).toBe(404);
        expect(await res.text()).toBe('not found');
    });

    test('POST /health returns the router 404 (health is GET-only)', async () => {
        const res = await invoke(
            new Request('https://builder.example.com/health', { method: 'POST' }),
        );

        expect(res.status).toBe(404);
        expect(await res.text()).toBe('not found');
    });

    test('GET /build returns the router 404 (build is POST-only)', async () => {
        const res = await invoke(new Request('https://builder.example.com/build'));

        expect(res.status).toBe(404);
        expect(await res.text()).toBe('not found');
    });

    test('POST /bundle/<hash> returns the router 404 (bundle is GET/HEAD-only)', async () => {
        const res = await invoke(
            new Request('https://builder.example.com/bundle/abcdef', { method: 'POST' }),
        );

        expect(res.status).toBe(404);
        expect(await res.text()).toBe('not found');
    });

    test('handler that throws is caught and returns a 500 with { error } JSON body', async () => {
        // Force the bundle handler to throw by passing an `env.BUNDLES`
        // whose `head` rejects — this proves the router's try/catch wraps
        // uncaught handler errors into a 500 JSON body.
        const throwingBundles = {
            async head(): Promise<never> {
                throw new Error('boom');
            },
            async get(): Promise<null> {
                return null;
            },
        } as unknown as R2Bucket;
        const env: Env = {
            ESM_BUILDER: {} as unknown as DurableObjectNamespace,
            BUILD_SESSION: {} as unknown as DurableObjectNamespace,
            BUNDLES: throwingBundles,
        };

        // Silence the router's expected `console.error('[worker]', err)`.
        const originalError = console.error;
        console.error = () => {};
        try {
            const handler = workerMod.default.fetch as (
                req: Request,
                env: Env,
            ) => Promise<Response>;
            const res = await handler(
                new Request('https://builder.example.com/bundle/abcdef'),
                env,
            );

            expect(res.status).toBe(500);
            expect(res.headers.get('Content-Type') ?? '').toContain('application/json');
            const body = (await res.json()) as { error: string };
            expect(body.error).toBe('boom');
        } finally {
            console.error = originalError;
        }
    });
});

describe('cf-esm-builder worker Durable Object exports', () => {
    test('exports BuildSession', () => {
        expect(typeof workerMod.BuildSession).toBe('function');
    });

    test('exports EsmBuilder (preserves existing wrangler binding)', () => {
        expect(typeof workerMod.EsmBuilder).toBe('function');
    });
});
