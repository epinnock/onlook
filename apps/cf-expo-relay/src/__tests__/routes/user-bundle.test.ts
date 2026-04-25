/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';

import {
    handleUserBundle,
    parseUserBundleRoute,
    USER_BUNDLE_ROUTE,
    type UserBundleRouteEnv,
} from '../../routes/user-bundle';

const HEX64 = '1111aaaabbbbccccddddeeeeffff00001111aaaabbbbccccddddeeeeffff0000';

function req(pathname: string, method = 'GET'): Request {
    return new Request(`https://expo-relay.dev.workers.dev${pathname}`, { method });
}

function envWith(
    serve: (url: string) => Response | Promise<Response>,
    opts: { viaBinding: boolean; cacheUrl?: string } = { viaBinding: true },
): { env: UserBundleRouteEnv; calls: string[] } {
    const calls: string[] = [];
    const cacheUrl = opts.cacheUrl ?? 'https://cf-esm-cache.dev.workers.dev';
    const env: UserBundleRouteEnv = {
        ESM_CACHE_URL: cacheUrl,
        ESM_CACHE: opts.viaBinding
            ? {
                  async fetch(request: Request): Promise<Response> {
                      calls.push(request.url);
                      return serve(request.url);
                  },
              }
            : undefined,
    };
    return { env, calls };
}

describe('USER_BUNDLE_ROUTE regex', () => {
    test('matches canonical shapes', () => {
        expect(`/${HEX64}.ios.bundle`).toMatch(USER_BUNDLE_ROUTE);
        expect(`/${HEX64}.android.bundle`).toMatch(USER_BUNDLE_ROUTE);
    });

    test('rejects uppercase hex, short hash, wrong platform, subpaths', () => {
        expect(`/${HEX64.toUpperCase()}.ios.bundle`).not.toMatch(USER_BUNDLE_ROUTE);
        expect(`/${HEX64.slice(0, 63)}.ios.bundle`).not.toMatch(USER_BUNDLE_ROUTE);
        expect(`/${HEX64}.windows.bundle`).not.toMatch(USER_BUNDLE_ROUTE);
        expect(`/bundle/${HEX64}.ios.bundle`).not.toMatch(USER_BUNDLE_ROUTE);
        expect(`/${HEX64}.ios.bundle/extra`).not.toMatch(USER_BUNDLE_ROUTE);
    });
});

describe('parseUserBundleRoute', () => {
    test('returns structured match for valid paths', () => {
        expect(parseUserBundleRoute(`/${HEX64}.ios.bundle`)).toEqual({
            hash: HEX64,
            platform: 'ios',
        });
        expect(parseUserBundleRoute(`/${HEX64}.android.bundle`)).toEqual({
            hash: HEX64,
            platform: 'android',
        });
    });

    test('returns null for invalid paths', () => {
        expect(parseUserBundleRoute('/manifest/' + HEX64)).toBeNull();
        expect(parseUserBundleRoute(`/${HEX64}.ios`)).toBeNull();
        expect(parseUserBundleRoute('/foo')).toBeNull();
    });
});

describe('handleUserBundle', () => {
    test('proxies to ESM_CACHE service binding with the right upstream path', async () => {
        const { env, calls } = envWith(() =>
            new Response('(() => { /* bundle */ })()', { status: 200 }),
        );
        const response = await handleUserBundle(req(`/${HEX64}.ios.bundle`), env);

        expect(response.status).toBe(200);
        expect(calls).toEqual([
            `https://cf-esm-cache.dev.workers.dev/bundle/${HEX64}/index.ios.bundle`,
        ]);
    });

    test('forwards the android platform segment', async () => {
        const { env, calls } = envWith(() => new Response('ok', { status: 200 }));
        await handleUserBundle(req(`/${HEX64}.android.bundle`), env);
        expect(calls[0]).toBe(
            `https://cf-esm-cache.dev.workers.dev/bundle/${HEX64}/index.android.bundle`,
        );
    });

    test('emits immutable cache headers + content-addressable ETag on hit', async () => {
        const body = 'globalThis.onlookMount = (p) => {};';
        const { env } = envWith(() =>
            new Response(body, {
                status: 200,
                headers: { 'Content-Type': 'text/plain' },
            }),
        );

        const response = await handleUserBundle(req(`/${HEX64}.ios.bundle`), env);

        expect(response.status).toBe(200);
        expect(response.headers.get('Content-Type')).toBe('application/javascript');
        expect(response.headers.get('Cache-Control')).toBe(
            'public, max-age=31536000, immutable',
        );
        expect(response.headers.get('ETag')).toBe(`"${HEX64}"`);
        expect(await response.text()).toBe(body);
    });

    test('mirrors upstream status on 404/5xx so callers see a real signal', async () => {
        const { env: env404 } = envWith(() => new Response('not found', { status: 404 }));
        const r404 = await handleUserBundle(req(`/${HEX64}.ios.bundle`), env404);
        expect(r404.status).toBe(404);
        expect(await r404.text()).toBe('expo-relay: bundle 404');

        const { env: env502 } = envWith(() => new Response('cache err', { status: 502 }));
        const r502 = await handleUserBundle(req(`/${HEX64}.ios.bundle`), env502);
        expect(r502.status).toBe(502);
        expect(await r502.text()).toBe('expo-relay: bundle 502');
    });

    test('strips trailing slash on ESM_CACHE_URL before composing upstream URL', async () => {
        const { env, calls } = envWith(
            () => new Response('ok', { status: 200 }),
            { viaBinding: true, cacheUrl: 'https://cache.example.com/' },
        );
        await handleUserBundle(req(`/${HEX64}.ios.bundle`), env);
        expect(calls[0]).toBe(
            `https://cache.example.com/bundle/${HEX64}/index.ios.bundle`,
        );
    });

    test('falls back to global fetch when ESM_CACHE binding is absent', async () => {
        const originalFetch = globalThis.fetch;
        const seenUrls: string[] = [];
        globalThis.fetch = (async (input: Request | string | URL) => {
            const url = typeof input === 'string'
                ? input
                : input instanceof URL
                    ? input.toString()
                    : input.url;
            seenUrls.push(url);
            return new Response('fallback body', {
                status: 200,
                headers: { 'Content-Type': 'text/plain' },
            });
        }) as typeof globalThis.fetch;

        try {
            const { env } = envWith(
                () => new Response('(should not be called)', { status: 500 }),
                { viaBinding: false },
            );
            const response = await handleUserBundle(req(`/${HEX64}.ios.bundle`), env);

            expect(response.status).toBe(200);
            expect(await response.text()).toBe('fallback body');
            expect(response.headers.get('Content-Type')).toBe('application/javascript');
            expect(seenUrls).toEqual([
                `https://cf-esm-cache.dev.workers.dev/bundle/${HEX64}/index.ios.bundle`,
            ]);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    test('returns 404 when the path does not match the route regex', async () => {
        const { env, calls } = envWith(() => new Response('x', { status: 200 }));
        const response = await handleUserBundle(req(`/manifest/${HEX64}`), env);
        expect(response.status).toBe(404);
        expect(await response.text()).toBe('expo-relay: not a user-bundle route');
        expect(calls).toEqual([]);
    });
});
