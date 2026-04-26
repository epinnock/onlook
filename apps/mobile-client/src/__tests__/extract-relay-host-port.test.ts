/**
 * Tests for extractRelayHostPort — the helper AppRouter's
 * buildUrlPipelineRunner uses to derive `{relayHost, relayPort}` from
 * the deep-link's parsed `relay=` URL. Previously the code
 * regex-matched against the deep-link itself (`data`) which fails for
 * `onlook://` schemes and silently fell back to defaults — producing
 * wrong props on every initial URL-submit mount.
 */
import { describe, expect, mock, test } from 'bun:test';

// Short-circuit the heavy screen import chain that AppRouter.tsx pulls in
// when we import the module — tests only need the pure helper export.
mock.module('react-native', () => ({
    View: () => null,
    StyleSheet: { create: (s: Record<string, unknown>) => s },
    Text: () => null,
    Pressable: () => null,
    ScrollView: () => null,
    Switch: () => null,
    Platform: { OS: 'ios' },
    AppState: { addEventListener: () => ({ remove: () => undefined }) },
    DevSettings: {
        addMenuItem: () => undefined,
        reload: () => undefined,
    },
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
mock.module('../deepLink/parse', () => ({
    parseOnlookDeepLink: () => null,
}));
mock.module('../deepLink/handler', () => ({
    useDeepLinkHandler: () => undefined,
    registerDeepLinkHandler: () => () => undefined,
}));
mock.module('../relay/manifestFetcher', () => ({
    fetchManifest: async () => ({ ok: false, error: 'unused' }),
}));
mock.module('../relay/bundleFetcher', () => ({
    fetchBundle: async () => ({ ok: false, error: 'unused' }),
}));
mock.module('expo-secure-store', () => ({
    getItemAsync: async () => null,
    setItemAsync: async () => {},
    deleteItemAsync: async () => {},
}));

const { extractRelayHostPort } = (await import('../navigation/AppRouter')) as typeof import(
    '../navigation/AppRouter'
);

describe('extractRelayHostPort', () => {
    test('parses http://host:port/path correctly', () => {
        expect(extractRelayHostPort('http://192.168.1.100:8891/manifest/abc')).toEqual({
            relayHost: '192.168.1.100',
            relayPort: 8891,
        });
    });

    test('parses https://host:port correctly', () => {
        expect(extractRelayHostPort('https://relay.onlook.com:8890/manifest/xyz')).toEqual({
            relayHost: 'relay.onlook.com',
            relayPort: 8890,
        });
    });

    test('parses ws:// and wss:// URL schemes', () => {
        expect(extractRelayHostPort('ws://host:8787/x')).toEqual({
            relayHost: 'host',
            relayPort: 8787,
        });
        expect(extractRelayHostPort('wss://host:443/x')).toEqual({
            relayHost: 'host',
            relayPort: 443,
        });
    });

    test('defaults to port 80 when http:// URL has no explicit port', () => {
        expect(extractRelayHostPort('http://relay.onlook.com/manifest/abc')).toEqual({
            relayHost: 'relay.onlook.com',
            relayPort: 80,
        });
    });

    test('defaults to port 443 when https:// URL has no explicit port', () => {
        expect(extractRelayHostPort('https://relay.onlook.com/manifest/abc')).toEqual({
            relayHost: 'relay.onlook.com',
            relayPort: 443,
        });
    });

    test('defaults to port 443 when wss:// URL has no explicit port', () => {
        expect(extractRelayHostPort('wss://relay.onlook.com/hmr/abc')).toEqual({
            relayHost: 'relay.onlook.com',
            relayPort: 443,
        });
    });

    test('unparseable URL falls back to 192.168.0.17:8788 (legacy default)', () => {
        expect(extractRelayHostPort('not-a-url')).toEqual({
            relayHost: '192.168.0.17',
            relayPort: 8788,
        });
    });

    test('empty string falls back to defaults', () => {
        expect(extractRelayHostPort('')).toEqual({
            relayHost: '192.168.0.17',
            relayPort: 8788,
        });
    });

    test('IPv4 with port extracts cleanly', () => {
        expect(extractRelayHostPort('http://10.0.0.5:9999/manifest/abc')).toEqual({
            relayHost: '10.0.0.5',
            relayPort: 9999,
        });
    });
});
