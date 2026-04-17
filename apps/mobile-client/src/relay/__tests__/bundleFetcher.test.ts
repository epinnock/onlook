/**
 * Tests for the Onlook mobile client bundle fetcher.
 *
 * Task: MC3.12
 * Validate: bun test apps/mobile-client/src/relay/__tests__/bundleFetcher.test.ts
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import type { BundleResult } from '../bundleFetcher';
import { fetchBundle } from '../bundleFetcher';

const BUNDLE_URL =
    'https://expo-relay.onlook.workers.dev/c6a1fbc03d4e7f1234567890abcdef0123456789abcdef0123456789abcdef01.android.bundle?platform=android';

const SAMPLE_BUNDLE = `(function(){var __DEV__=false;var __BUNDLE_START_TIME__=Date.now();
// ... Metro-style bundle content ...
console.log("Hello, Onlook!");
})();`;

function jsResponse(body: string, status = 200): Response {
    return new Response(body, {
        status,
        statusText: status === 200 ? 'OK' : 'Error',
        headers: { 'Content-Type': 'application/javascript' },
    });
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
    globalThis.fetch = originalFetch;
});

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe('fetchBundle', () => {
    test('successful fetch returns ok:true with source string', async () => {
        globalThis.fetch = mock(() => Promise.resolve(jsResponse(SAMPLE_BUNDLE)));

        const result: BundleResult = await fetchBundle(BUNDLE_URL);

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.source).toBe(SAMPLE_BUNDLE);
            expect(result.source).toContain('Hello, Onlook!');
        }
    });

    test('network error returns ok:false with descriptive message', async () => {
        globalThis.fetch = mock(() =>
            Promise.reject(new Error('ECONNREFUSED 127.0.0.1:8787')),
        );

        const result = await fetchBundle(BUNDLE_URL);

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toContain('Network error');
            expect(result.error).toContain('ECONNREFUSED');
        }
    });

    test('non-200 HTTP status returns ok:false with status in error message', async () => {
        globalThis.fetch = mock(() =>
            Promise.resolve(
                new Response('not found', {
                    status: 404,
                    statusText: 'Not Found',
                }),
            ),
        );

        const result = await fetchBundle(BUNDLE_URL);

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toContain('404');
            expect(result.error).toContain('Not Found');
        }
    });

    test('empty body returns ok:false', async () => {
        globalThis.fetch = mock(() =>
            Promise.resolve(
                new Response('', {
                    status: 200,
                    headers: { 'Content-Type': 'application/javascript' },
                }),
            ),
        );

        const result = await fetchBundle(BUNDLE_URL);

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toContain('Empty bundle');
        }
    });

    test('large bundle (>1MB) still works', async () => {
        // Generate a bundle that exceeds 1 MB.
        const largePadding = 'x'.repeat(1_100_000);
        const largeBundle = `(function(){${largePadding}})();`;

        globalThis.fetch = mock(() => Promise.resolve(jsResponse(largeBundle)));

        const result = await fetchBundle(BUNDLE_URL);

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.source.length).toBeGreaterThan(1_000_000);
            expect(result.source).toBe(largeBundle);
        }
    });

    test('500 server error returns ok:false with status', async () => {
        globalThis.fetch = mock(() =>
            Promise.resolve(
                new Response('internal server error', {
                    status: 500,
                    statusText: 'Internal Server Error',
                }),
            ),
        );

        const result = await fetchBundle(BUNDLE_URL);

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toContain('500');
        }
    });

    test('missing Content-Type header warns but still returns ok:true', async () => {
        const warnMock = mock(() => {});
        const originalWarn = console.warn;
        console.warn = warnMock;

        globalThis.fetch = mock(() =>
            Promise.resolve(
                new Response(SAMPLE_BUNDLE, {
                    status: 200,
                    // No Content-Type header
                }),
            ),
        );

        const result = await fetchBundle(BUNDLE_URL);

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.source).toBe(SAMPLE_BUNDLE);
        }
        expect(warnMock).toHaveBeenCalledTimes(1);

        console.warn = originalWarn;
    });

    test('unexpected Content-Type warns but still returns ok:true', async () => {
        const warnMock = mock(() => {});
        const originalWarn = console.warn;
        console.warn = warnMock;

        globalThis.fetch = mock(() =>
            Promise.resolve(
                new Response(SAMPLE_BUNDLE, {
                    status: 200,
                    headers: { 'Content-Type': 'text/plain' },
                }),
            ),
        );

        const result = await fetchBundle(BUNDLE_URL);

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.source).toBe(SAMPLE_BUNDLE);
        }
        expect(warnMock).toHaveBeenCalledTimes(1);

        console.warn = originalWarn;
    });

    test('text/javascript Content-Type is accepted without warning', async () => {
        const warnMock = mock(() => {});
        const originalWarn = console.warn;
        console.warn = warnMock;

        globalThis.fetch = mock(() =>
            Promise.resolve(
                new Response(SAMPLE_BUNDLE, {
                    status: 200,
                    headers: { 'Content-Type': 'text/javascript; charset=utf-8' },
                }),
            ),
        );

        const result = await fetchBundle(BUNDLE_URL);

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.source).toBe(SAMPLE_BUNDLE);
        }
        expect(warnMock).not.toHaveBeenCalled();

        console.warn = originalWarn;
    });

    test('non-Error thrown by fetch is stringified in error message', async () => {
        globalThis.fetch = mock(() => Promise.reject('string error'));

        const result = await fetchBundle(BUNDLE_URL);

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toContain('Network error');
            expect(result.error).toContain('string error');
        }
    });

    test('uses GET method', async () => {
        const fetchMock = mock(() => Promise.resolve(jsResponse(SAMPLE_BUNDLE)));
        globalThis.fetch = fetchMock;

        await fetchBundle(BUNDLE_URL);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const init = fetchMock.mock.calls[0]![1] as RequestInit;
        expect(init.method).toBe('GET');
    });
});
