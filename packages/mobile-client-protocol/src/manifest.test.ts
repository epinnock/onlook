import { describe, expect, test } from 'bun:test';
import { ManifestSchema } from './manifest.ts';

const FIXTURE = {
    id: 'session-abc-123',
    createdAt: '2026-04-11T00:00:00.000Z',
    runtimeVersion: '54.0.0',
    launchAsset: {
        hash: 'a3f8',
        key: 'bundle.js',
        contentType: 'application/javascript',
        url: 'https://relay.onlook.com/bundle/session-abc-123',
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

describe('ManifestSchema', () => {
    test('parses a realistic cf-expo-relay manifest', () => {
        const parsed = ManifestSchema.parse(FIXTURE);
        expect(parsed.id).toBe('session-abc-123');
        expect(parsed.launchAsset.url).toMatch(/^https:/);
        expect(parsed.extra.expoClient.onlookRuntimeVersion).toBe('0.1.0');
        expect(parsed.extra.expoClient.protocolVersion).toBe(1);
    });

    test('extra.expoClient is passthrough — unknown keys preserved', () => {
        const parsed = ManifestSchema.parse({
            ...FIXTURE,
            extra: {
                expoClient: {
                    ...FIXTURE.extra.expoClient,
                    sdkVersion: '54.0.0',
                    platform: 'ios',
                },
            },
        });
        expect((parsed.extra.expoClient as Record<string, unknown>).sdkVersion).toBe('54.0.0');
    });

    test('rejects manifest without launchAsset', () => {
        const { launchAsset, ...withoutLaunch } = FIXTURE;
        void launchAsset;
        expect(() => ManifestSchema.parse(withoutLaunch)).toThrow();
    });

    test('rejects non-URL launchAsset.url', () => {
        expect(() =>
            ManifestSchema.parse({
                ...FIXTURE,
                launchAsset: { ...FIXTURE.launchAsset, url: 'not-a-url' },
            }),
        ).toThrow();
    });

    test('onlookRuntimeVersion is optional (N-1 compatibility window)', () => {
        const { onlookRuntimeVersion, ...rest } = FIXTURE.extra.expoClient;
        void onlookRuntimeVersion;
        const parsed = ManifestSchema.parse({
            ...FIXTURE,
            extra: { expoClient: rest },
        });
        expect(parsed.extra.expoClient.onlookRuntimeVersion).toBeUndefined();
    });
});
