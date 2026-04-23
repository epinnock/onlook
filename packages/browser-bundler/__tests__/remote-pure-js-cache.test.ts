import { describe, expect, test } from 'bun:test';

import { createInMemoryPureJsCache, type PureJsPackageArtifact } from '../src/pure-js-package';
import {
    createLayeredPureJsCache,
    createRemotePureJsCache,
} from '../src/remote-pure-js-cache';

function makeArtifact(
    overrides: Partial<PureJsPackageArtifact> = {},
): PureJsPackageArtifact {
    return {
        packageName: 'lodash',
        version: '4.17.21',
        artifactHash: 'hash',
        entry: 'index.js',
        modules: {
            'index.js': 'module.exports = {};',
        },
        subpaths: {},
        ...overrides,
    };
}

describe('createRemotePureJsCache — get', () => {
    test('returns the artifact body on 200', async () => {
        const artifact = makeArtifact();
        const fetchImpl = async () =>
            new Response(JSON.stringify(artifact), {
                status: 200,
                headers: { 'Content-Type': 'application/json' },
            });
        const cache = createRemotePureJsCache({
            baseUrl: 'https://cdn.test/artifacts/',
            fetchImpl,
        });
        const got = await cache.get('lodash', '4.17.21');
        expect(got?.packageName).toBe('lodash');
        expect(got?.version).toBe('4.17.21');
    });

    test('returns null on 404', async () => {
        const fetchImpl = async () => new Response(null, { status: 404 });
        const cache = createRemotePureJsCache({
            baseUrl: 'https://cdn.test/artifacts/',
            fetchImpl,
        });
        const got = await cache.get('lodash', '4.17.21');
        expect(got).toBeNull();
    });

    test('throws on non-2xx / non-404 response', async () => {
        const fetchImpl = async () => new Response('boom', { status: 500, statusText: 'server error' });
        const cache = createRemotePureJsCache({
            baseUrl: 'https://cdn.test/artifacts/',
            fetchImpl,
        });
        await expect(cache.get('lodash', '4.17.21')).rejects.toThrow(/500/);
    });

    test('rejects when the body name/version mismatches the request', async () => {
        const artifact = makeArtifact({ packageName: 'zod' }); // body says zod, we asked for lodash
        const fetchImpl = async () =>
            new Response(JSON.stringify(artifact), { status: 200 });
        const cache = createRemotePureJsCache({
            baseUrl: 'https://cdn.test/artifacts/',
            fetchImpl,
        });
        await expect(cache.get('lodash', '4.17.21')).rejects.toThrow(/body mismatch/);
    });

    test('normalizes missing trailing slash in baseUrl', async () => {
        let capturedUrl = '';
        const artifact = makeArtifact();
        const fetchImpl = async (url: RequestInfo | URL) => {
            capturedUrl = url.toString();
            return new Response(JSON.stringify(artifact), { status: 200 });
        };
        const cache = createRemotePureJsCache({
            baseUrl: 'https://cdn.test/artifacts', // NO trailing slash
            fetchImpl,
        });
        await cache.get('lodash', '4.17.21');
        expect(capturedUrl).toBe('https://cdn.test/artifacts/lodash/4.17.21.json');
    });

    test('encodes scoped package names per-segment', async () => {
        let capturedUrl = '';
        const artifact = makeArtifact({ packageName: '@scope/pkg', version: '1.0.0' });
        const fetchImpl = async (url: RequestInfo | URL) => {
            capturedUrl = url.toString();
            return new Response(JSON.stringify(artifact), { status: 200 });
        };
        const cache = createRemotePureJsCache({
            baseUrl: 'https://cdn.test/artifacts/',
            fetchImpl,
        });
        await cache.get('@scope/pkg', '1.0.0');
        // @ encoded to %40, / stays as separator
        expect(capturedUrl).toBe('https://cdn.test/artifacts/%40scope/pkg/1.0.0.json');
    });
});

describe('createRemotePureJsCache — put', () => {
    test('returns true on 201', async () => {
        const fetchImpl = async () => new Response(null, { status: 201 });
        const cache = createRemotePureJsCache({
            baseUrl: 'https://cdn.test/artifacts/',
            fetchImpl,
        });
        expect(await cache.put(makeArtifact())).toBe(true);
    });

    test('returns true on 200 (overwrite)', async () => {
        const fetchImpl = async () => new Response(null, { status: 200 });
        const cache = createRemotePureJsCache({
            baseUrl: 'https://cdn.test/artifacts/',
            fetchImpl,
        });
        expect(await cache.put(makeArtifact())).toBe(true);
    });

    test('returns false on 4xx/5xx', async () => {
        const fetchImpl = async () => new Response(null, { status: 409 });
        const cache = createRemotePureJsCache({
            baseUrl: 'https://cdn.test/artifacts/',
            fetchImpl,
        });
        expect(await cache.put(makeArtifact())).toBe(false);
    });

    test('sends a PUT with application/json body', async () => {
        let capturedMethod = '';
        let capturedContentType = '';
        let capturedBody = '';
        const fetchImpl = async (_url: RequestInfo | URL, init?: RequestInit) => {
            capturedMethod = (init?.method ?? 'GET').toUpperCase();
            capturedContentType = (init?.headers as Record<string, string> | undefined)?.['Content-Type'] ?? '';
            capturedBody = (init?.body as string | undefined) ?? '';
            return new Response(null, { status: 201 });
        };
        const cache = createRemotePureJsCache({
            baseUrl: 'https://cdn.test/artifacts/',
            fetchImpl,
        });
        const artifact = makeArtifact();
        await cache.put(artifact);
        expect(capturedMethod).toBe('PUT');
        expect(capturedContentType).toBe('application/json');
        expect(JSON.parse(capturedBody).packageName).toBe('lodash');
    });
});

describe('createRemotePureJsCache — has', () => {
    test('returns true on 200', async () => {
        const fetchImpl = async () => new Response(null, { status: 200 });
        const cache = createRemotePureJsCache({
            baseUrl: 'https://cdn.test/artifacts/',
            fetchImpl,
        });
        expect(await cache.has('lodash', '4.17.21')).toBe(true);
    });

    test('returns false on 404', async () => {
        const fetchImpl = async () => new Response(null, { status: 404 });
        const cache = createRemotePureJsCache({
            baseUrl: 'https://cdn.test/artifacts/',
            fetchImpl,
        });
        expect(await cache.has('lodash', '4.17.21')).toBe(false);
    });

    test('issues HEAD rather than GET', async () => {
        let capturedMethod = '';
        const fetchImpl = async (_url: RequestInfo | URL, init?: RequestInit) => {
            capturedMethod = (init?.method ?? 'GET').toUpperCase();
            return new Response(null, { status: 200 });
        };
        const cache = createRemotePureJsCache({
            baseUrl: 'https://cdn.test/artifacts/',
            fetchImpl,
        });
        await cache.has('lodash', '4.17.21');
        expect(capturedMethod).toBe('HEAD');
    });
});

describe('createRemotePureJsCache — misconfig', () => {
    test('throws if the provided fetchImpl is not a function', () => {
        // `undefined` would fall back to globalThis.fetch (present in Bun).
        // Pass an explicit non-function to exercise the guard.
        expect(() =>
            createRemotePureJsCache({
                baseUrl: 'https://cdn.test/artifacts/',
                fetchImpl: 'nope' as unknown as typeof fetch,
            }),
        ).toThrow(/no fetch/);
    });
});

describe('createLayeredPureJsCache', () => {
    test('fast-cache hit short-circuits slow-cache lookup', async () => {
        const fast = createInMemoryPureJsCache();
        const artifact = makeArtifact();
        await fast.put(artifact);

        let slowCalled = 0;
        const slow = {
            async get(_name: string, _version: string) {
                slowCalled += 1;
                return null;
            },
        };

        const layered = createLayeredPureJsCache(fast, slow);
        const got = await layered.get('lodash', '4.17.21');
        expect(got?.packageName).toBe('lodash');
        expect(slowCalled).toBe(0);
    });

    test('slow-cache result populates the fast cache (next call is a fast hit)', async () => {
        const fast = createInMemoryPureJsCache();
        const artifact = makeArtifact();

        let slowCalls = 0;
        const slow = {
            async get(name: string, version: string) {
                slowCalls += 1;
                return name === 'lodash' && version === '4.17.21' ? artifact : null;
            },
        };

        const layered = createLayeredPureJsCache(fast, slow);
        const first = await layered.get('lodash', '4.17.21');
        const second = await layered.get('lodash', '4.17.21');
        expect(first?.packageName).toBe('lodash');
        expect(second?.packageName).toBe('lodash');
        // Slow cache called once — second call hit the populated fast cache.
        expect(slowCalls).toBe(1);
    });

    test('fast-cache put failures are non-fatal', async () => {
        const fast = {
            async get() {
                return null;
            },
            async put() {
                throw new Error('disk full');
            },
        };
        const artifact = makeArtifact();
        const slow = {
            async get() {
                return artifact;
            },
        };
        const layered = createLayeredPureJsCache(fast, slow);
        // Should not throw — put failure is swallowed.
        const got = await layered.get('lodash', '4.17.21');
        expect(got?.packageName).toBe('lodash');
    });

    test('returns null when both caches miss', async () => {
        const fast = createInMemoryPureJsCache();
        const slow = {
            async get() {
                return null;
            },
        };
        const layered = createLayeredPureJsCache(fast, slow);
        expect(await layered.get('missing', '1.0.0')).toBeNull();
    });
});
