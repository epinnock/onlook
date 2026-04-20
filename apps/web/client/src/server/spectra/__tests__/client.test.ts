import { describe, expect, test } from 'bun:test';

import { SpectraApiError, SpectraClient, SpectraConfigError } from '../client';

interface CapturedCall {
    url: string;
    init: RequestInit;
}

function mockFetch(responses: Array<{ status: number; body: unknown } | Response>): {
    fn: typeof fetch;
    calls: CapturedCall[];
} {
    const calls: CapturedCall[] = [];
    let i = 0;
    const fn = (async (url: string | URL, init: RequestInit = {}) => {
        calls.push({ url: url.toString(), init });
        const next = responses[i++];
        if (!next) throw new Error('mockFetch: ran out of scripted responses');
        if (next instanceof Response) return next;
        return new Response(typeof next.body === 'string' ? next.body : JSON.stringify(next.body), {
            status: next.status,
            headers: { 'content-type': 'application/json' },
        });
    }) as unknown as typeof fetch;
    return { fn, calls };
}

describe('SpectraClient', () => {
    test('throws SpectraConfigError when baseUrl is missing', () => {
        expect(() => new SpectraClient({ baseUrl: '' })).toThrow(SpectraConfigError);
    });

    test('strips trailing slashes from the base URL', async () => {
        const { fn, calls } = mockFetch([{ status: 200, body: { ok: true } }]);
        const client = new SpectraClient({
            baseUrl: 'http://localhost:3001///',
            fetchImpl: fn,
        });
        await client.tap('dev-1', 0.5, 0.5);
        expect(calls[0]!.url).toBe('http://localhost:3001/v1/devices/dev-1/tap');
    });

    test('createSimulator posts the expected body and parses the response', async () => {
        const device = {
            id: 'dev-1',
            name: 'Onlook Preview',
            platform: 'ios',
            status: 'online',
            simUdid: 'sim-123',
            ports: { wda: 8110 },
        };
        const { fn, calls } = mockFetch([{ status: 201, body: device }]);
        const client = new SpectraClient({
            baseUrl: 'http://localhost:3001',
            fetchImpl: fn,
        });
        const result = await client.createSimulator({
            name: 'Onlook Preview',
            installAppId: 'abc',
        });
        expect(result.id).toBe('dev-1');
        expect(calls[0]!.url).toBe('http://localhost:3001/v1/devices');
        expect(calls[0]!.init.method).toBe('POST');
        const body = JSON.parse(calls[0]!.init.body as string);
        expect(body).toMatchObject({
            platform: 'ios',
            iosKind: 'simulator',
            installAppId: 'abc',
            name: 'Onlook Preview',
        });
    });

    test('tap sends normalized coords in the body', async () => {
        const { fn, calls } = mockFetch([{ status: 200, body: { ok: true } }]);
        const client = new SpectraClient({ baseUrl: 'http://localhost:3001', fetchImpl: fn });
        await client.tap('dev-1', 0.25, 0.75);
        const body = JSON.parse(calls[0]!.init.body as string);
        expect(body).toEqual({ x: 0.25, y: 0.75 });
    });

    test('openUrl posts the url and encodes the device id', async () => {
        const { fn, calls } = mockFetch([{ status: 200, body: { ok: true } }]);
        const client = new SpectraClient({ baseUrl: 'http://localhost:3001', fetchImpl: fn });
        await client.openUrl('dev with space', 'onlook://launch?x=1&y=2');
        expect(calls[0]!.url).toBe('http://localhost:3001/v1/devices/dev%20with%20space/open-url');
        const body = JSON.parse(calls[0]!.init.body as string);
        expect(body).toEqual({ url: 'onlook://launch?x=1&y=2' });
    });

    test('request() surfaces upstream error messages verbatim', async () => {
        const { fn } = mockFetch([{ status: 500, body: { error: 'WDA not ready' } }]);
        const client = new SpectraClient({ baseUrl: 'http://localhost:3001', fetchImpl: fn });
        let caught: unknown;
        try {
            await client.tap('dev-1', 0.1, 0.1);
        } catch (err) {
            caught = err;
        }
        expect(caught).toBeInstanceOf(SpectraApiError);
        expect((caught as Error).message).toMatch(/WDA not ready/);
    });

    test('deleteDevice tolerates 404s', async () => {
        const { fn } = mockFetch([{ status: 404, body: { error: 'not found' } }]);
        const client = new SpectraClient({ baseUrl: 'http://localhost:3001', fetchImpl: fn });
        // Should not throw.
        await client.deleteDevice('dev-gone');
    });

    test('authHeaders returns empty when no token is configured', () => {
        const client = new SpectraClient({ baseUrl: 'http://localhost:3001', fetchImpl: fetch });
        expect(client.authHeaders).toEqual({});
    });

    test('authHeaders returns a bearer header when a token is configured', () => {
        const client = new SpectraClient({
            baseUrl: 'http://localhost:3001',
            token: 'abc',
            fetchImpl: fetch,
        });
        expect(client.authHeaders).toEqual({ Authorization: 'Bearer abc' });
    });
});
