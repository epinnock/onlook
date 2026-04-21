/**
 * Tests for the Onlook mobile client manifest fetcher.
 *
 * Task: MC3.11
 * Validate: bun test apps/mobile-client/src/relay/__tests__/manifestFetcher.test.ts
 */

import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';
import { fetchManifest } from '../manifestFetcher';

/** A valid manifest fixture that passes ManifestSchema validation. */
const VALID_MANIFEST = {
    id: 'c6a1fbc0-3d4e-4f12-b456-7890abcdef01',
    createdAt: '2026-04-11T00:00:00.000Z',
    runtimeVersion: '54.0.0',
    launchAsset: {
        hash: 'a3f8deadbeef',
        key: 'bundle',
        contentType: 'application/javascript',
        url: 'https://relay.onlook.com/c6a1fbc03d4e7f1234567890abcdef0123456789abcdef0123456789abcdef01.android.bundle?platform=android',
    },
    assets: [],
    extra: {
        expoClient: {
            onlookRuntimeVersion: '0.1.0',
            protocolVersion: 1,
            scheme: 'onlook',
        },
    },
};

const RELAY_URL = 'https://expo-relay.onlook.workers.dev/manifest/c6a1fbc03d4e7f1234567890abcdef0123456789abcdef0123456789abcdef01';

const BOUNDARY = 'formdata-c6a1fbc03d4e7f12';

/** Wrap manifest JSON in a multipart/mixed envelope matching the relay's format. */
function wrapMultipart(json: string): string {
    return (
        `--${BOUNDARY}\r\n` +
        `Content-Disposition: form-data; name="manifest"\r\n` +
        `Content-Type: application/json\r\n` +
        `\r\n` +
        `${json}\r\n` +
        `--${BOUNDARY}--\r\n`
    );
}

function multipartResponse(body: unknown, status = 200): Response {
    const json = JSON.stringify(body);
    return new Response(wrapMultipart(json), {
        status,
        statusText: status === 200 ? 'OK' : 'Error',
        headers: {
            'Content-Type': `multipart/mixed; boundary=${BOUNDARY}`,
            'Cache-Control': 'private, max-age=0',
            'expo-protocol-version': '0',
            'expo-sfv-version': '0',
        },
    });
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        statusText: status === 200 ? 'OK' : 'Error',
        headers: { 'Content-Type': 'application/json' },
    });
}

const originalFetch = globalThis.fetch;

beforeEach(() => {
    // Reset fetch before each test
    globalThis.fetch = originalFetch;
});

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe('fetchManifest', () => {
    test('successful fetch with valid multipart manifest returns ok:true', async () => {
        globalThis.fetch = mock(() => Promise.resolve(multipartResponse(VALID_MANIFEST)));

        const result = await fetchManifest(RELAY_URL);

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.manifest.id).toBe(VALID_MANIFEST.id);
            expect(result.manifest.runtimeVersion).toBe('54.0.0');
            expect(result.manifest.launchAsset.url).toContain('android.bundle');
            expect(result.manifest.assets).toHaveLength(0);
            expect(result.manifest.extra.expoClient.onlookRuntimeVersion).toBe('0.1.0');
        }
    });

    test('successful fetch with plain JSON response returns ok:true', async () => {
        globalThis.fetch = mock(() => Promise.resolve(jsonResponse(VALID_MANIFEST)));

        const result = await fetchManifest(RELAY_URL);

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(result.manifest.id).toBe(VALID_MANIFEST.id);
        }
    });

    test('network error returns ok:false with descriptive message', async () => {
        globalThis.fetch = mock(() => Promise.reject(new Error('DNS resolution failed')));

        const result = await fetchManifest(RELAY_URL);

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toContain('Network error');
            expect(result.error).toContain('DNS resolution failed');
        }
    });

    test('non-200 HTTP status returns ok:false', async () => {
        globalThis.fetch = mock(() =>
            Promise.resolve(
                new Response('not found', {
                    status: 404,
                    statusText: 'Not Found',
                }),
            ),
        );

        const result = await fetchManifest(RELAY_URL);

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toContain('404');
        }
    });

    test('500 server error returns ok:false', async () => {
        globalThis.fetch = mock(() =>
            Promise.resolve(
                new Response('internal server error', {
                    status: 500,
                    statusText: 'Internal Server Error',
                }),
            ),
        );

        const result = await fetchManifest(RELAY_URL);

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toContain('500');
        }
    });

    test('invalid JSON body returns ok:false', async () => {
        globalThis.fetch = mock(() =>
            Promise.resolve(
                new Response('this is not json at all {{{', {
                    status: 200,
                    headers: { 'Content-Type': 'application/json' },
                }),
            ),
        );

        const result = await fetchManifest(RELAY_URL);

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toContain('Invalid JSON');
        }
    });

    test('Zod-invalid manifest shape returns ok:false', async () => {
        const invalidManifest = {
            id: 'some-id',
            // missing required fields: createdAt, runtimeVersion, launchAsset, assets, extra
        };

        globalThis.fetch = mock(() => Promise.resolve(jsonResponse(invalidManifest)));

        const result = await fetchManifest(RELAY_URL);

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toContain('Manifest validation failed');
        }
    });

    test('manifest with invalid launchAsset.url fails Zod validation', async () => {
        const badUrlManifest = {
            ...VALID_MANIFEST,
            launchAsset: {
                ...VALID_MANIFEST.launchAsset,
                url: 'not-a-url',
            },
        };

        globalThis.fetch = mock(() => Promise.resolve(jsonResponse(badUrlManifest)));

        const result = await fetchManifest(RELAY_URL);

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toContain('Manifest validation failed');
        }
    });

    test('malformed multipart body (no manifest part) returns ok:false', async () => {
        const brokenMultipart =
            `--${BOUNDARY}\r\n` +
            `Content-Disposition: form-data; name="other"\r\n` +
            `Content-Type: text/plain\r\n` +
            `\r\n` +
            `some random content\r\n` +
            `--${BOUNDARY}--\r\n`;

        globalThis.fetch = mock(() =>
            Promise.resolve(
                new Response(brokenMultipart, {
                    status: 200,
                    headers: {
                        'Content-Type': `multipart/mixed; boundary=${BOUNDARY}`,
                    },
                }),
            ),
        );

        const result = await fetchManifest(RELAY_URL);

        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toContain('extract manifest');
        }
    });

    test('passes correct Accept header, platform header, GET method, and ?format=json query', async () => {
        const fetchMock = mock(() => Promise.resolve(jsonResponse(VALID_MANIFEST)));
        globalThis.fetch = fetchMock;

        await fetchManifest(RELAY_URL);

        expect(fetchMock).toHaveBeenCalledTimes(1);
        const calledRequest = fetchMock.mock.calls[0];
        // fetchManifest opts into the relay's ?format=json bypass path so
        // the response is plain JSON instead of multipart/mixed — RN fetch
        // + multipart hangs on response.text() in iOS 18.6 sim. Also pins
        // platform=ios because the relay defaults to android otherwise.
        const calledUrl = calledRequest[0] as string;
        expect(calledUrl.startsWith(RELAY_URL)).toBe(true);
        expect(calledUrl).toContain('format=json');
        expect(calledUrl).toContain('platform=ios');
        const init = calledRequest[1] as RequestInit;
        expect(init.method).toBe('GET');
        const headers = init.headers as Record<string, string>;
        expect(headers.Accept).toBe('application/json');
        expect(headers['Expo-Platform']).toBe('ios');
    });

    test('manifest with extra passthrough fields in expoClient is accepted', async () => {
        const extendedManifest = {
            ...VALID_MANIFEST,
            extra: {
                expoClient: {
                    ...VALID_MANIFEST.extra.expoClient,
                    sdkVersion: '54.0.0',
                    name: 'Onlook Preview',
                    slug: 'onlook-preview',
                    _internal: { isDebug: false },
                },
            },
        };

        globalThis.fetch = mock(() => Promise.resolve(jsonResponse(extendedManifest)));

        const result = await fetchManifest(RELAY_URL);

        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(
                (result.manifest.extra.expoClient as Record<string, unknown>).sdkVersion,
            ).toBe('54.0.0');
        }
    });
});
