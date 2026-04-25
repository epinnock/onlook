/**
 * Tests for {@link buildDeepLinkPipelineUrl} — the rebuild helper the
 * AppRouter deep-link callback uses to feed the URL-pipeline runner.
 *
 * The pipeline runner is a stable string-typed entry point that re-parses
 * its input via `parseOnlookDeepLink`, so the rebuilt URL must round-trip
 * back to the same `{action, sessionId, relay}` triple the handler
 * received. These tests pin that contract: rebuild → re-parse equality on
 * both schemes the parser accepts (onlook:// native, exp:// alias).
 */
import { describe, expect, mock, test } from 'bun:test';

mock.module('react-native', () => ({
    View: () => null,
    StyleSheet: { create: (s: Record<string, unknown>) => s },
    Text: () => null,
    Pressable: () => null,
    ScrollView: () => null,
    Switch: () => null,
    AppState: { addEventListener: () => ({ remove: () => undefined }) },
    DevSettings: { addMenuItem: () => undefined, reload: () => undefined },
}));
mock.module('../screens', () => ({
    CrashScreen: () => null,
    ErrorScreen: () => null,
    LauncherScreen: () => null,
    ProgressScreen: () => null,
    ScanScreen: () => null,
    ScreensGalleryScreen: () => null,
    SettingsScreen: () => null,
    VersionMismatchScreen: () => null,
}));
mock.module('../flow/qrToMount', () => ({
    qrToMount: async () => ({ ok: false, stage: 'parse', error: 'unused' }),
    __resetQrToMountState: () => {},
}));
mock.module('../relay/manifestFetcher', () => ({
    fetchManifest: async () => ({ ok: false, error: 'unused' }),
}));
mock.module('../relay/bundleFetcher', () => ({
    fetchBundle: async () => ({ ok: false, error: 'unused' }),
}));
mock.module('../deepLink/handler', () => ({
    useDeepLinkHandler: () => undefined,
    registerDeepLinkHandler: () => () => undefined,
}));
mock.module('expo-secure-store', () => ({
    getItemAsync: async () => null,
    setItemAsync: async () => {},
    deleteItemAsync: async () => {},
}));

const { buildDeepLinkPipelineUrl } = await import('../navigation/AppRouter');
const { parseOnlookDeepLink } = await import('../deepLink/parse');

describe('buildDeepLinkPipelineUrl', () => {
    test('returns null when sessionId is missing', () => {
        expect(
            buildDeepLinkPipelineUrl({ action: 'launch', relay: 'http://x:1' }),
        ).toBeNull();
    });

    test('returns null when relay is missing', () => {
        expect(
            buildDeepLinkPipelineUrl({ action: 'launch', sessionId: 'abc' }),
        ).toBeNull();
    });

    test('returns null when both sessionId and relay missing', () => {
        expect(buildDeepLinkPipelineUrl({ action: 'launch' })).toBeNull();
    });

    test('rebuilds a canonical onlook:// URL', () => {
        const url = buildDeepLinkPipelineUrl({
            action: 'launch',
            sessionId: 'sample-1',
            relay: 'http://192.168.0.14:18788',
        });
        expect(url).toBe(
            'onlook://launch?session=sample-1&relay=http%3A%2F%2F192.168.0.14%3A18788',
        );
    });

    test('rebuilt URL round-trips back through parseOnlookDeepLink', () => {
        const input = {
            action: 'launch',
            sessionId: 'session-xyz',
            relay: 'http://192.168.0.14:18788',
        };
        const url = buildDeepLinkPipelineUrl(input);
        expect(url).not.toBeNull();
        const reparsed = parseOnlookDeepLink(url!);
        expect(reparsed).toEqual(input);
    });

    test('rebuild from exp:// alias parse round-trips', () => {
        const expParsed = parseOnlookDeepLink(
            'exp://192.168.0.14:18788/manifest/sample-abc',
        );
        expect(expParsed).not.toBeNull();
        const rebuilt = buildDeepLinkPipelineUrl(expParsed!);
        expect(rebuilt).not.toBeNull();
        const rereparsed = parseOnlookDeepLink(rebuilt!);
        expect(rereparsed).toEqual(expParsed);
    });

    test('encodes special characters in sessionId and relay', () => {
        const url = buildDeepLinkPipelineUrl({
            action: 'launch',
            sessionId: 'a b/c',
            relay: 'http://host?x=1&y=2',
        });
        expect(url).toBe(
            'onlook://launch?session=a%20b%2Fc&relay=http%3A%2F%2Fhost%3Fx%3D1%26y%3D2',
        );
    });
});
