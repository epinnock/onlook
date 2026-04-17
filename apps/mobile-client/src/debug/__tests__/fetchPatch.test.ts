/**
 * Tests for the fetch patch (network inspector).
 *
 * Task: MC5.3
 * Validate: bun test apps/mobile-client/src/debug/__tests__/fetchPatch.test.ts
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { FetchPatch } from '../fetchPatch';
import type { NetworkEntry } from '../fetchPatch';

/** Helper: create a minimal mock Response. */
function mockResponse(status: number, headers?: Record<string, string>): Response {
    const h = new Headers(headers);
    return new Response(null, { status, headers: h });
}

describe('FetchPatch', () => {
    let patch: FetchPatch;
    let originalFetch: typeof globalThis.fetch;

    beforeEach(() => {
        patch = new FetchPatch();
        // Save genuine original before each test.
        originalFetch = globalThis.fetch;
    });

    afterEach(() => {
        // Always uninstall + restore in case a test fails mid-way.
        patch.uninstall();
        globalThis.fetch = originalFetch;
    });

    test('install patches globalThis.fetch', () => {
        const before = globalThis.fetch;
        patch.install();
        expect(globalThis.fetch).not.toBe(before);
    });

    test('original fetch is still called', async () => {
        const spy = mock(() => Promise.resolve(mockResponse(200)));
        globalThis.fetch = spy;

        patch.install();
        await globalThis.fetch('https://example.com/api');

        expect(spy).toHaveBeenCalledTimes(1);
    });

    test('successful request captures status and duration', async () => {
        const spy = mock(() =>
            Promise.resolve(mockResponse(201, { 'x-custom': 'value' })),
        );
        globalThis.fetch = spy;

        patch.install();
        const response = await globalThis.fetch('https://example.com/data', {
            method: 'POST',
        });

        // The original Response is returned transparently.
        expect(response.status).toBe(201);

        const buffer = patch.getBuffer();
        expect(buffer).toHaveLength(1);

        const entry = buffer[0]!;
        expect(entry.method).toBe('POST');
        expect(entry.url).toBe('https://example.com/data');
        expect(entry.status).toBe(201);
        expect(entry.duration).toBeGreaterThanOrEqual(0);
        expect(entry.endTime).not.toBeNull();
        expect(entry.startTime).toMatch(/^\d{4}-\d{2}-\d{2}T/);
        expect(entry.responseHeaders).toBeDefined();
        expect(entry.responseHeaders!['x-custom']).toBe('value');
        expect(entry.error).toBeUndefined();
    });

    test('failed request captures error', async () => {
        const spy = mock(() => Promise.reject(new Error('network failure')));
        globalThis.fetch = spy;

        patch.install();

        await expect(globalThis.fetch('https://example.com/fail')).rejects.toThrow(
            'network failure',
        );

        const buffer = patch.getBuffer();
        expect(buffer).toHaveLength(1);

        const entry = buffer[0]!;
        expect(entry.error).toBe('network failure');
        expect(entry.status).toBeNull();
        expect(entry.endTime).not.toBeNull();
        expect(entry.duration).toBeGreaterThanOrEqual(0);
    });

    test('uninstall restores original fetch', () => {
        const orig = globalThis.fetch;
        patch.install();
        expect(globalThis.fetch).not.toBe(orig);

        patch.uninstall();
        expect(globalThis.fetch).toBe(orig);
    });

    test('buffer caps at 100 entries', async () => {
        const spy = mock(() => Promise.resolve(mockResponse(200)));
        globalThis.fetch = spy;

        patch.install();

        // Fire 120 requests.
        const promises: Promise<Response>[] = [];
        for (let i = 0; i < 120; i++) {
            promises.push(globalThis.fetch(`https://example.com/${i}`));
        }
        await Promise.all(promises);

        const buffer = patch.getBuffer();
        expect(buffer).toHaveLength(100);
        // Oldest 20 should have been evicted.
        expect(buffer[0]!.url).toBe('https://example.com/20');
        expect(buffer[99]!.url).toBe('https://example.com/119');
    });

    test('listener receives entries', async () => {
        const spy = mock(() => Promise.resolve(mockResponse(200)));
        globalThis.fetch = spy;

        const received: NetworkEntry[] = [];
        patch.onEntry((entry) => received.push(entry));

        patch.install();
        await globalThis.fetch('https://example.com/listen');

        expect(received).toHaveLength(1);
        expect(received[0]!.url).toBe('https://example.com/listen');
        expect(received[0]!.status).toBe(200);
    });

    test('unsubscribe stops delivery to that listener', async () => {
        const spy = mock(() => Promise.resolve(mockResponse(200)));
        globalThis.fetch = spy;

        const received: NetworkEntry[] = [];
        const unsub = patch.onEntry((entry) => received.push(entry));

        patch.install();
        await globalThis.fetch('https://example.com/a');
        expect(received).toHaveLength(1);

        unsub();
        await globalThis.fetch('https://example.com/b');
        expect(received).toHaveLength(1);
    });

    test('clearBuffer empties the buffer', async () => {
        const spy = mock(() => Promise.resolve(mockResponse(200)));
        globalThis.fetch = spy;

        patch.install();
        await globalThis.fetch('https://example.com/clear');
        expect(patch.getBuffer()).toHaveLength(1);

        patch.clearBuffer();
        expect(patch.getBuffer()).toHaveLength(0);
    });

    test('handles Request object input', async () => {
        const spy = mock(() => Promise.resolve(mockResponse(204)));
        globalThis.fetch = spy;

        patch.install();
        const req = new Request('https://example.com/request-obj', {
            method: 'PUT',
            headers: { 'content-type': 'application/json' },
        });
        await globalThis.fetch(req);

        const buffer = patch.getBuffer();
        expect(buffer).toHaveLength(1);

        const entry = buffer[0]!;
        expect(entry.method).toBe('PUT');
        expect(entry.url).toBe('https://example.com/request-obj');
        expect(entry.requestHeaders).toBeDefined();
        expect(entry.requestHeaders!['content-type']).toBe('application/json');
    });

    test('install is idempotent (second call is a no-op)', () => {
        const orig = globalThis.fetch;
        patch.install();
        const patched = globalThis.fetch;
        patch.install(); // second call
        expect(globalThis.fetch).toBe(patched);

        patch.uninstall();
        expect(globalThis.fetch).toBe(orig);
    });

    test('default method is GET for plain string URL', async () => {
        const spy = mock(() => Promise.resolve(mockResponse(200)));
        globalThis.fetch = spy;

        patch.install();
        await globalThis.fetch('https://example.com/get');

        const entry = patch.getBuffer()[0]!;
        expect(entry.method).toBe('GET');
    });
});
