/**
 * Expo app config for @onlook/mobile-client.
 *
 * Consumed by `expo prebuild` (Phase F task MCF8) to generate the iOS and
 * Android native project trees. Pinned to SDK 54 / RN 0.81.6 / React 19.1.0
 * to match packages/mobile-preview/runtime exactly — see the source plan's
 * "Reconciler version mismatch" risk row for why.
 *
 * Scope (MCF8):
 *   - Bundle identifier: com.onlook.mobile
 *   - URL scheme: onlook (for onlook://launch?session=… deep links)
 *   - jsEngine: hermes (required — the runtime asset is Hermes-compatible)
 *   - newArchEnabled: true (bridgeless + Fabric, per source plan Phase 1)
 *   - Module allowlist: expo-camera, expo-secure-store, expo-haptics only.
 *     Every other Expo module stays OUT of the build. See SUPPORTED_MODULES.md
 *     (landed by Wave 1 task MC1.9) for the enforcement story.
 */
import type { ExpoConfig } from 'expo/config';
import { ONLOOK_RUNTIME_VERSION } from '@onlook/mobile-client-protocol';

const config: ExpoConfig = {
    name: 'Onlook Mobile Client',
    slug: 'onlook-mobile-client',
    // Single source of truth: MC6.1 routes Expo's binary version
    // (→ iOS CFBundleShortVersionString, Android versionName on prebuild)
    // through the same `ONLOOK_RUNTIME_VERSION` constant that the wire
    // protocol and C++ runtime header already read, so the store-facing
    // label can never drift from the runtime compatibility version.
    version: ONLOOK_RUNTIME_VERSION,
    orientation: 'portrait',
    scheme: 'onlook',
    userInterfaceStyle: 'automatic',
    newArchEnabled: true,
    jsEngine: 'hermes',
    ios: {
        bundleIdentifier: 'com.onlook.mobile',
        supportsTablet: true,
        infoPlist: {
            // Camera permission copy shown on first QR scan. Source plan Phase 3.
            NSCameraUsageDescription:
                'Onlook Mobile Client uses the camera to scan QR codes that link your phone to an Onlook editor workspace.',
            // Allow cleartext local-relay dev against http://localhost:8787.
            // Production relay over HTTPS is unaffected.
            NSAppTransportSecurity: {
                NSAllowsLocalNetworking: true,
            },
            // iOS 14+ Local Network Privacy: without this key, apps
            // silently fail to reach LAN/loopback even with
            // NSAllowsLocalNetworking=true (the ATS exception). The
            // two-tier preview flow needs to fetch manifest + bundle
            // from cf-expo-relay over plain HTTP on the dev LAN
            // (e.g. http://192.168.x.y:8787) and open a WebSocket to
            // /hmr/:sessionId, both of which count as "local network"
            // access. This description is shown in the iOS permission
            // prompt the first time the app tries to reach the LAN.
            NSLocalNetworkUsageDescription:
                'Onlook Mobile Client connects to the Onlook editor running on your local network to fetch preview bundles and receive live overlays.',
        },
        // MCF8 pre-populates the URL scheme via expo's `scheme` field above;
        // that expands into CFBundleURLTypes during prebuild.
    },
    android: {
        package: 'com.onlook.mobile',
        permissions: ['android.permission.CAMERA', 'android.permission.INTERNET'],
        // Deep-link intent filter for onlook:// — expanded from `scheme`.
    },
    plugins: [
        [
            'expo-camera',
            {
                cameraPermission:
                    'Onlook Mobile Client uses the camera to scan QR codes that link your phone to an Onlook editor workspace.',
            },
        ],
        'expo-secure-store',
        // expo-haptics is a runtime module, NOT a config plugin — it has no
        // app.plugin.js. It stays as a dependency (see package.json) so
        // `import * as Haptics from 'expo-haptics'` works at runtime, but it
        // doesn't belong in this array.
    ],
    // Runtime version is pinned to the @onlook/mobile-client-protocol constant
    // so the relay manifest's extra.expoClient.onlookRuntimeVersion field
    // (MC6.2) stays in sync with the binary.
    runtimeVersion: ONLOOK_RUNTIME_VERSION,
    extra: {
        eas: {
            // Intentionally empty until a maintainer runs `eas init` on a
            // logged-in Mac. MC6.5 wired up the `eas.json` + TestFlight
            // profiles, but the projectId can only be allocated by the
            // interactive `eas init` step (Expo doesn't let CI create
            // projects without human approval). First real `eas build`
            // invocation will prompt for it; the resulting projectId
            // should then be committed here. See
            // `apps/mobile-client/docs/MC6.5-testflight.md` §§40-41, 94-95,
            // 150-152 for the full handoff contract.
            projectId: '',
        },
    },
};

export default config;
