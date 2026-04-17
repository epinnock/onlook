import { describe, expect, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import {
    fetchMobilePreviewConnection,
    useMobilePreviewConnection,
    type MobilePreviewConnectionStatus,
} from '../use-mobile-preview-connection';

function makeJsonResponse(
    body: unknown,
    init: { ok?: boolean; status?: number } = {},
): Response {
    return {
        ok: init.ok ?? true,
        status: init.status ?? 200,
        json: async () => body,
    } as Response;
}

describe('fetchMobilePreviewConnection', () => {
    test('returns disabled when the server URL is missing', async () => {
        const status = await fetchMobilePreviewConnection({});

        expect(status).toEqual({
            kind: 'disabled',
            clients: 0,
            hasRuntime: false,
            message:
                'Missing mobile preview server URL — set NEXT_PUBLIC_MOBILE_PREVIEW_URL.',
        });
    });

    test('returns waiting when the server is reachable with no clients', async () => {
        const status = await fetchMobilePreviewConnection({
            serverBaseUrl: 'http://localhost:8787/',
            fetchFn: async (input, init) => {
                expect(input).toBe('http://localhost:8787/status');
                expect(init).toEqual({
                    method: 'GET',
                    cache: 'no-store',
                });
                return makeJsonResponse({
                    clients: 0,
                    runtimeHash: 'runtime_hash',
                });
            },
        });

        expect(status).toEqual({
            kind: 'waiting',
            clients: 0,
            hasRuntime: true,
        });
    });

    test('returns connected when at least one client is attached', async () => {
        const status = await fetchMobilePreviewConnection({
            serverBaseUrl: 'http://localhost:8787',
            fetchFn: async () =>
                makeJsonResponse({
                    clients: 3,
                    runtimeHash: 'runtime_hash',
                }),
        });

        expect(status).toEqual({
            kind: 'connected',
            clients: 3,
            hasRuntime: true,
        });
    });

    test('returns an error when /status returns a non-2xx response', async () => {
        const status = await fetchMobilePreviewConnection({
            serverBaseUrl: 'http://localhost:8787',
            fetchFn: async () => makeJsonResponse({}, { ok: false, status: 503 }),
        });

        expect(status).toEqual({
            kind: 'error',
            clients: 0,
            hasRuntime: false,
            message: 'mobile-preview /status returned 503',
        });
    });

    test('returns an error when the request throws', async () => {
        const status = await fetchMobilePreviewConnection({
            serverBaseUrl: 'http://localhost:8787',
            fetchFn: async () => {
                throw new Error('network down');
            },
        });

        expect(status).toEqual({
            kind: 'error',
            clients: 0,
            hasRuntime: false,
            message: 'Failed to reach mobile-preview server: network down',
        });
    });
});

describe('useMobilePreviewConnection initial render', () => {
    test('starts disabled when no server URL is provided', () => {
        const captured: {
            status?: MobilePreviewConnectionStatus;
            refresh?: () => Promise<void>;
        } = {};

        function Probe() {
            const result = useMobilePreviewConnection({});
            captured.status = result.status;
            captured.refresh = result.refresh;
            return null;
        }

        renderToStaticMarkup(<Probe />);

        expect(captured.status).toEqual({
            kind: 'disabled',
            clients: 0,
            hasRuntime: false,
            message:
                'Missing mobile preview server URL — set NEXT_PUBLIC_MOBILE_PREVIEW_URL.',
        });
        expect(typeof captured.refresh).toBe('function');
    });

    test('starts checking when a server URL is provided', () => {
        const captured: {
            status?: MobilePreviewConnectionStatus;
            refresh?: () => Promise<void>;
        } = {};

        function Probe() {
            const result = useMobilePreviewConnection({
                serverBaseUrl: 'http://localhost:8787',
            });
            captured.status = result.status;
            captured.refresh = result.refresh;
            return null;
        }

        renderToStaticMarkup(<Probe />);

        expect(captured.status).toEqual({
            kind: 'checking',
            clients: 0,
            hasRuntime: false,
        });
        expect(typeof captured.refresh).toBe('function');
    });
});
