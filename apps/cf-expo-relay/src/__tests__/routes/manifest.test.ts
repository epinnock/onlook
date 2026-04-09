/// <reference types="bun" />
import { describe, expect, test } from 'bun:test';

import type { ExpoManifest, ManifestFields } from '../../manifest-builder';
import {
    handleManifest,
    resolvePlatform,
    type ManifestRouteEnv,
    type ServiceBinding,
} from '../../routes/manifest';

const VALID_HASH =
    'c6a1fbc03d4e7f1234567890abcdef0123456789abcdef0123456789abcdef01';
const CACHE_URL = 'https://cf-esm-cache.dev.workers.dev';
const FIXED_BUILT_AT = '2026-04-07T21:00:00.000Z';

function baseFields(overrides: Partial<ManifestFields> = {}): ManifestFields {
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
        ...overrides,
    };
}

interface StubResponses {
    fields?: Response;
    meta?: Response;
}

interface StubResult {
    binding: ServiceBinding;
    /** All URLs the route asked the stub binding to fetch, in call order. */
    calls: string[];
}

/**
 * Build a stub `ESM_CACHE` service binding that returns canned responses for
 * the two known sub-paths and 404s anything else. Tracks call order so the
 * tests can assert on which URLs were touched.
 */
function makeStubBinding(responses: StubResponses): StubResult {
    const calls: string[] = [];
    const binding: ServiceBinding = {
        async fetch(request: Request): Promise<Response> {
            calls.push(request.url);
            if (request.url.endsWith('/manifest-fields.json')) {
                return responses.fields ?? new Response('not found', { status: 404 });
            }
            if (request.url.endsWith('/meta.json')) {
                return responses.meta ?? new Response('not found', { status: 404 });
            }
            return new Response('unexpected', { status: 500 });
        },
    };
    return { binding, calls };
}

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), {
        status,
        headers: { 'Content-Type': 'application/json' },
    });
}

function makeRequest(
    bundleHash: string,
    opts?: { platform?: 'ios' | 'android' },
): Request {
    const headers: Record<string, string> = {};
    if (opts?.platform) {
        headers['expo-platform'] = opts.platform;
    }
    return new Request(`https://expo-relay.dev.workers.dev/manifest/${bundleHash}`, {
        headers,
    });
}

function envFor(binding: ServiceBinding): ManifestRouteEnv {
    return { ESM_CACHE: binding, ESM_CACHE_URL: CACHE_URL };
}

describe('handleManifest (TQ1.2)', () => {
    test('rejects malformed bundleHash with 400', async () => {
        const { binding, calls } = makeStubBinding({});
        const response = await handleManifest(
            makeRequest('not-a-hash'),
            envFor(binding),
            'not-a-hash',
        );
        expect(response.status).toBe(400);
        expect(calls).toHaveLength(0);
    });

    test('rejects 63-char hash with 400', async () => {
        const short = 'c6a1fbc03d4e7f1234567890abcdef0123456789abcdef0123456789abcdef0';
        const { binding } = makeStubBinding({});
        const response = await handleManifest(makeRequest(short), envFor(binding), short);
        expect(response.status).toBe(400);
    });

    test('rejects uppercase-hex hash with 400 (canonical form is lowercase)', async () => {
        const upper = VALID_HASH.toUpperCase();
        const { binding } = makeStubBinding({});
        const response = await handleManifest(makeRequest(upper), envFor(binding), upper);
        expect(response.status).toBe(400);
    });

    test('returns 404 when manifest-fields.json is missing', async () => {
        const { binding, calls } = makeStubBinding({
            fields: new Response('not found', { status: 404 }),
            meta: jsonResponse({ builtAt: FIXED_BUILT_AT }),
        });
        const response = await handleManifest(
            makeRequest(VALID_HASH),
            envFor(binding),
            VALID_HASH,
        );
        expect(response.status).toBe(404);
        // We should have asked for manifest-fields.json before bailing out.
        expect(calls.some((u) => u.endsWith('/manifest-fields.json'))).toBe(true);
    });

    test('happy path: returns valid Expo manifest with all required headers', async () => {
        const fields = baseFields({
            assets: [
                {
                    key: 'asset-key-1',
                    contentType: 'image/png',
                    fileExtension: '.png',
                },
            ],
        });
        const { binding, calls } = makeStubBinding({
            fields: jsonResponse(fields),
            meta: jsonResponse({ builtAt: FIXED_BUILT_AT }),
        });

        const response = await handleManifest(
            makeRequest(VALID_HASH),
            envFor(binding),
            VALID_HASH,
        );
        expect(response.status).toBe(200);

        // All four required Expo headers from TQ0.2.
        expect(response.headers.get('Content-Type')).toBe('application/json');
        expect(response.headers.get('Cache-Control')).toBe('no-cache, no-store');
        expect(response.headers.get('expo-protocol-version')).toBe('1');
        expect(response.headers.get('expo-sfv-version')).toBe('0');

        const manifest = (await response.json()) as ExpoManifest;
        expect(manifest.id).toBe(VALID_HASH);
        expect(manifest.createdAt).toBe(FIXED_BUILT_AT);
        expect(manifest.runtimeVersion).toBe('1.0.0');
        expect(manifest.launchAsset.url).toBe(
            `${CACHE_URL}/bundle/${VALID_HASH}/index.android.bundle`,
        );
        expect(manifest.assets).toHaveLength(1);
        expect(manifest.assets[0]?.url).toBe(
            `${CACHE_URL}/bundle/${VALID_HASH}/asset-key-1.png`,
        );

        // Both upstream files should have been fetched.
        expect(calls.some((u) => u.endsWith('/manifest-fields.json'))).toBe(true);
        expect(calls.some((u) => u.endsWith('/meta.json'))).toBe(true);
    });

    test("manifest body's id matches bundleHash", async () => {
        const { binding } = makeStubBinding({
            fields: jsonResponse(baseFields()),
            meta: jsonResponse({ builtAt: FIXED_BUILT_AT }),
        });
        const response = await handleManifest(
            makeRequest(VALID_HASH),
            envFor(binding),
            VALID_HASH,
        );
        const manifest = (await response.json()) as ExpoManifest;
        expect(manifest.id).toBe(VALID_HASH);
    });

    test("launchAsset.url includes cfEsmCacheUrl + bundleHash", async () => {
        const { binding } = makeStubBinding({
            fields: jsonResponse(baseFields()),
            meta: jsonResponse({ builtAt: FIXED_BUILT_AT }),
        });
        const response = await handleManifest(
            makeRequest(VALID_HASH),
            envFor(binding),
            VALID_HASH,
        );
        const manifest = (await response.json()) as ExpoManifest;
        expect(manifest.launchAsset.url).toContain(CACHE_URL);
        expect(manifest.launchAsset.url).toContain(VALID_HASH);
        expect(manifest.launchAsset.url).toBe(
            `${CACHE_URL}/bundle/${VALID_HASH}/index.android.bundle`,
        );
    });

    test('all four required Expo headers are present', async () => {
        const { binding } = makeStubBinding({
            fields: jsonResponse(baseFields()),
            meta: jsonResponse({ builtAt: FIXED_BUILT_AT }),
        });
        const response = await handleManifest(
            makeRequest(VALID_HASH),
            envFor(binding),
            VALID_HASH,
        );
        expect(response.headers.get('Content-Type')).toBe('application/json');
        expect(response.headers.get('Cache-Control')).toBe('no-cache, no-store');
        expect(response.headers.get('expo-protocol-version')).toBe('1');
        expect(response.headers.get('expo-sfv-version')).toBe('0');
    });

    test('falls back to a fresh ISO timestamp when meta.json is missing', async () => {
        const { binding } = makeStubBinding({
            fields: jsonResponse(baseFields()),
            meta: new Response('not found', { status: 404 }),
        });
        const before = Date.now();
        const response = await handleManifest(
            makeRequest(VALID_HASH),
            envFor(binding),
            VALID_HASH,
        );
        const after = Date.now();
        expect(response.status).toBe(200);
        const manifest = (await response.json()) as ExpoManifest;
        const parsed = Date.parse(manifest.createdAt);
        expect(Number.isNaN(parsed)).toBe(false);
        expect(parsed).toBeGreaterThanOrEqual(before);
        expect(parsed).toBeLessThanOrEqual(after);
    });

    test('falls back to a fresh ISO timestamp when meta.json is malformed', async () => {
        const { binding } = makeStubBinding({
            fields: jsonResponse(baseFields()),
            meta: new Response('not-json', { status: 200 }),
        });
        const before = Date.now();
        const response = await handleManifest(
            makeRequest(VALID_HASH),
            envFor(binding),
            VALID_HASH,
        );
        const after = Date.now();
        expect(response.status).toBe(200);
        const manifest = (await response.json()) as ExpoManifest;
        const parsed = Date.parse(manifest.createdAt);
        expect(Number.isNaN(parsed)).toBe(false);
        expect(parsed).toBeGreaterThanOrEqual(before);
        expect(parsed).toBeLessThanOrEqual(after);
    });

    test('returns 502 when manifest-fields.json is unparseable', async () => {
        const { binding } = makeStubBinding({
            fields: new Response('definitely not json', { status: 200 }),
            meta: jsonResponse({ builtAt: FIXED_BUILT_AT }),
        });
        const response = await handleManifest(
            makeRequest(VALID_HASH),
            envFor(binding),
            VALID_HASH,
        );
        expect(response.status).toBe(502);
    });

    test('returns 502 when cache returns a non-404 error for manifest-fields.json', async () => {
        const { binding } = makeStubBinding({
            fields: new Response('boom', { status: 500 }),
            meta: jsonResponse({ builtAt: FIXED_BUILT_AT }),
        });
        const response = await handleManifest(
            makeRequest(VALID_HASH),
            envFor(binding),
            VALID_HASH,
        );
        expect(response.status).toBe(502);
    });

    test('asks the cache for /bundle/<hash>/manifest-fields.json and /bundle/<hash>/meta.json', async () => {
        const { binding, calls } = makeStubBinding({
            fields: jsonResponse(baseFields()),
            meta: jsonResponse({ builtAt: FIXED_BUILT_AT }),
        });
        await handleManifest(makeRequest(VALID_HASH), envFor(binding), VALID_HASH);
        expect(calls).toContain(`${CACHE_URL}/bundle/${VALID_HASH}/manifest-fields.json`);
        expect(calls).toContain(`${CACHE_URL}/bundle/${VALID_HASH}/meta.json`);
    });

    test('strips trailing slash from ESM_CACHE_URL when computing upstream paths', async () => {
        const { binding, calls } = makeStubBinding({
            fields: jsonResponse(baseFields()),
            meta: jsonResponse({ builtAt: FIXED_BUILT_AT }),
        });
        const env: ManifestRouteEnv = {
            ESM_CACHE: binding,
            ESM_CACHE_URL: `${CACHE_URL}/`,
        };
        const response = await handleManifest(makeRequest(VALID_HASH), env, VALID_HASH);
        expect(response.status).toBe(200);
        for (const call of calls) {
            expect(call).not.toContain('//bundle');
        }
    });

    test('routes launchAsset.url to index.android.bundle when no platform header is present', async () => {
        const { binding } = makeStubBinding({
            fields: jsonResponse(baseFields()),
            meta: jsonResponse({ builtAt: FIXED_BUILT_AT }),
        });
        const response = await handleManifest(
            makeRequest(VALID_HASH),
            envFor(binding),
            VALID_HASH,
        );
        const manifest = (await response.json()) as ExpoManifest;
        expect(manifest.launchAsset.url).toBe(
            `${CACHE_URL}/bundle/${VALID_HASH}/index.android.bundle`,
        );
    });

    test('routes launchAsset.url to index.ios.bundle when Expo-Platform header is ios', async () => {
        const { binding } = makeStubBinding({
            fields: jsonResponse(baseFields()),
            meta: jsonResponse({ builtAt: FIXED_BUILT_AT }),
        });
        const response = await handleManifest(
            makeRequest(VALID_HASH, { platform: 'ios' }),
            envFor(binding),
            VALID_HASH,
        );
        const manifest = (await response.json()) as ExpoManifest;
        expect(manifest.launchAsset.url).toBe(
            `${CACHE_URL}/bundle/${VALID_HASH}/index.ios.bundle`,
        );
    });

    test('routes launchAsset.url to index.android.bundle when Expo-Platform header is android', async () => {
        const { binding } = makeStubBinding({
            fields: jsonResponse(baseFields()),
            meta: jsonResponse({ builtAt: FIXED_BUILT_AT }),
        });
        const response = await handleManifest(
            makeRequest(VALID_HASH, { platform: 'android' }),
            envFor(binding),
            VALID_HASH,
        );
        const manifest = (await response.json()) as ExpoManifest;
        expect(manifest.launchAsset.url).toBe(
            `${CACHE_URL}/bundle/${VALID_HASH}/index.android.bundle`,
        );
    });

    test('falls back to ?platform= query string when Expo-Platform header is missing', async () => {
        const { binding } = makeStubBinding({
            fields: jsonResponse(baseFields()),
            meta: jsonResponse({ builtAt: FIXED_BUILT_AT }),
        });
        const queryRequest = new Request(
            `https://expo-relay.dev.workers.dev/manifest/${VALID_HASH}?platform=ios`,
        );
        const response = await handleManifest(
            queryRequest,
            envFor(binding),
            VALID_HASH,
        );
        const manifest = (await response.json()) as ExpoManifest;
        expect(manifest.launchAsset.url).toBe(
            `${CACHE_URL}/bundle/${VALID_HASH}/index.ios.bundle`,
        );
    });

    test('Expo-Platform header takes precedence over ?platform= query string', async () => {
        const { binding } = makeStubBinding({
            fields: jsonResponse(baseFields()),
            meta: jsonResponse({ builtAt: FIXED_BUILT_AT }),
        });
        // Header says android, query says ios — header wins.
        const conflictingRequest = new Request(
            `https://expo-relay.dev.workers.dev/manifest/${VALID_HASH}?platform=ios`,
            { headers: { 'expo-platform': 'android' } },
        );
        const response = await handleManifest(
            conflictingRequest,
            envFor(binding),
            VALID_HASH,
        );
        const manifest = (await response.json()) as ExpoManifest;
        expect(manifest.launchAsset.url).toBe(
            `${CACHE_URL}/bundle/${VALID_HASH}/index.android.bundle`,
        );
    });

    test('unknown platform header values fall back to android (cheaper than 400ing)', async () => {
        const { binding } = makeStubBinding({
            fields: jsonResponse(baseFields()),
            meta: jsonResponse({ builtAt: FIXED_BUILT_AT }),
        });
        // Web is a real Expo platform but we don't ship a web Hermes bundle —
        // serving the android URL is harmless because Expo Go won't try to
        // load it on a web target.
        const webRequest = new Request(
            `https://expo-relay.dev.workers.dev/manifest/${VALID_HASH}`,
            { headers: { 'expo-platform': 'web' } },
        );
        const response = await handleManifest(
            webRequest,
            envFor(binding),
            VALID_HASH,
        );
        expect(response.status).toBe(200);
        const manifest = (await response.json()) as ExpoManifest;
        expect(manifest.launchAsset.url).toBe(
            `${CACHE_URL}/bundle/${VALID_HASH}/index.android.bundle`,
        );
    });
});

describe('resolvePlatform (TQ1.2 iOS support)', () => {
    function reqWith(headers: HeadersInit, urlSuffix = ''): Request {
        return new Request(
            `https://expo-relay.dev.workers.dev/manifest/abc${urlSuffix}`,
            { headers },
        );
    }

    test("returns 'ios' for Expo-Platform: ios", () => {
        expect(resolvePlatform(reqWith({ 'expo-platform': 'ios' }))).toBe('ios');
    });

    test("returns 'android' for Expo-Platform: android", () => {
        expect(resolvePlatform(reqWith({ 'expo-platform': 'android' }))).toBe(
            'android',
        );
    });

    test("returns 'android' when no header is present", () => {
        expect(resolvePlatform(reqWith({}))).toBe('android');
    });

    test("returns 'ios' for ?platform=ios when no header is present", () => {
        expect(resolvePlatform(reqWith({}, '?platform=ios'))).toBe('ios');
    });

    test("returns 'android' for ?platform=android when no header is present", () => {
        expect(resolvePlatform(reqWith({}, '?platform=android'))).toBe('android');
    });

    test("returns 'android' for unrecognized header values", () => {
        expect(resolvePlatform(reqWith({ 'expo-platform': 'web' }))).toBe(
            'android',
        );
        expect(resolvePlatform(reqWith({ 'expo-platform': '' }))).toBe('android');
    });

    test("header takes precedence over ?platform= query", () => {
        expect(
            resolvePlatform(
                reqWith({ 'expo-platform': 'android' }, '?platform=ios'),
            ),
        ).toBe('android');
    });
});
