/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import {
    buildManifest,
    bundleHashToUuidV4,
    type BuildManifestInput,
    type ManifestFields,
} from "../manifest-builder";

/** A canonical empty-asset fields payload mirroring the Phase Q seed fixture. */
function baseFields(overrides: Partial<ManifestFields> = {}): ManifestFields {
    return {
        runtimeVersion: "exposdk:54.0.0",
        launchAsset: {
            key: "bundle-c6a1fbc03d4e7f1234567890abcdef0123456789abcdef0123456789abcdef01",
            contentType: "application/javascript",
        },
        assets: [],
        metadata: {},
        extra: {
            expoClient: {
                name: "Onlook Preview",
                slug: "onlook-preview",
                version: "1.0.0",
                sdkVersion: "54.0.0",
                platforms: ["ios", "android"],
                icon: null,
                splash: { backgroundColor: "#ffffff" },
                newArchEnabled: true,
            },
            scopeKey: "@onlook/preview",
            eas: { projectId: null },
        },
        ...overrides,
    };
}

const FIXED_BUNDLE_HASH =
    "c6a1fbc03d4e7f1234567890abcdef0123456789abcdef0123456789abcdef01";
const FIXED_CACHE_URL = "https://cf-esm-cache.dev.workers.dev";
const FIXED_RELAY_HOST = "expo-relay.dev.workers.dev";
const FIXED_BUILT_AT = "2026-04-07T21:00:00.000Z";

function baseInput(overrides: Partial<BuildManifestInput> = {}): BuildManifestInput {
    return {
        bundleHash: FIXED_BUNDLE_HASH,
        cfEsmCacheUrl: FIXED_CACHE_URL,
        relayHostUri: FIXED_RELAY_HOST,
        fields: baseFields(),
        builtAt: FIXED_BUILT_AT,
        ...overrides,
    };
}

describe("buildManifest", () => {
    test("id is a deterministic UUID v4 derived from the bundle hash", () => {
        const manifest = buildManifest(baseInput());
        // Same hash → same UUID v4 syntactically.
        expect(manifest.id).toMatch(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
        );
        expect(manifest.id).toBe(bundleHashToUuidV4(FIXED_BUNDLE_HASH));
    });

    test("launchAsset.key is the LITERAL string 'bundle' (matches expo-cli)", () => {
        const manifest = buildManifest(baseInput());
        expect(manifest.launchAsset.key).toBe("bundle");
    });

    test("launchAsset.url uses Metro convention with the relay host and platform query", () => {
        const manifest = buildManifest(baseInput({ platform: "ios" }));
        expect(manifest.launchAsset.url).toBe(
            `https://${FIXED_RELAY_HOST}/${FIXED_BUNDLE_HASH}.ios.bundle?` +
                "platform=ios&dev=false&hot=false&lazy=true&minify=true" +
                "&transform.engine=hermes&transform.bytecode=1" +
                "&transform.routerRoot=app&unstable_transformProfile=hermes-stable",
        );
    });

    test("launchAsset.url defaults to android when no platform is specified", () => {
        const manifest = buildManifest(baseInput());
        expect(manifest.launchAsset.url).toContain(`${FIXED_BUNDLE_HASH}.android.bundle`);
        expect(manifest.launchAsset.url).toContain("platform=android");
    });

    test("launchAsset.url uses platform=android when platform='android'", () => {
        const manifest = buildManifest(baseInput({ platform: "android" }));
        expect(manifest.launchAsset.url).toContain(`${FIXED_BUNDLE_HASH}.android.bundle`);
        expect(manifest.launchAsset.url).toContain("platform=android");
    });

    test("launchAsset.url uses platform=ios when platform='ios'", () => {
        const manifest = buildManifest(baseInput({ platform: "ios" }));
        expect(manifest.launchAsset.url).toContain(`${FIXED_BUNDLE_HASH}.ios.bundle`);
        expect(manifest.launchAsset.url).toContain("platform=ios");
    });

    test("createdAt is normalized to include milliseconds", () => {
        const manifest = buildManifest(baseInput({ builtAt: "2025-12-31T23:59:59Z" }));
        expect(manifest.createdAt).toBe("2025-12-31T23:59:59.000Z");
    });

    test("createdAt is left alone when it already has milliseconds", () => {
        const manifest = buildManifest(
            baseInput({ builtAt: "2025-12-31T23:59:59.999Z" }),
        );
        expect(manifest.createdAt).toBe("2025-12-31T23:59:59.999Z");
    });

    test("createdAt defaults to a parseable ISO string when not provided", () => {
        const before = Date.now();
        const manifest = buildManifest({
            bundleHash: FIXED_BUNDLE_HASH,
            cfEsmCacheUrl: FIXED_CACHE_URL,
            relayHostUri: FIXED_RELAY_HOST,
            fields: baseFields(),
        });
        const after = Date.now();
        const parsed = Date.parse(manifest.createdAt);
        expect(Number.isNaN(parsed)).toBe(false);
        expect(parsed).toBeGreaterThanOrEqual(before);
        expect(parsed).toBeLessThanOrEqual(after);
    });

    test("extra.expoClient strips icon, splash, and inner runtimeVersion", () => {
        const manifest = buildManifest(baseInput());
        const ec = manifest.extra.expoClient as Record<string, unknown>;
        expect(ec.icon).toBeUndefined();
        expect(ec.splash).toBeUndefined();
        expect(ec.runtimeVersion).toBeUndefined();
    });

    test("extra.expoClient._internal block is present", () => {
        const manifest = buildManifest(baseInput());
        expect(manifest.extra.expoClient._internal).toEqual({
            isDebug: false,
            projectRoot: "/private/tmp/onlook-fixture",
            dynamicConfigPath: null,
            staticConfigPath: "/private/tmp/onlook-fixture/app.json",
            packageJsonPath: "/private/tmp/onlook-fixture/package.json",
        });
    });

    test("extra.expoClient.hostUri is set to the relay host", () => {
        const manifest = buildManifest(baseInput());
        expect(manifest.extra.expoClient.hostUri).toBe(FIXED_RELAY_HOST);
    });

    test("extra.expoGo block matches expo-cli's exact shape", () => {
        const manifest = buildManifest(baseInput());
        expect(manifest.extra.expoGo).toEqual({
            debuggerHost: FIXED_RELAY_HOST,
            developer: {
                tool: "expo-cli",
                projectRoot: "/private/tmp/onlook-fixture",
            },
            packagerOpts: { dev: false },
            mainModuleName: "index.ts",
        });
    });

    test("extra.eas is an empty object (not { projectId: null })", () => {
        const manifest = buildManifest(baseInput());
        expect(manifest.extra.eas).toEqual({});
    });

    test("extra.scopeKey is in @anonymous/<slug>-<uuid> format", () => {
        const manifest = buildManifest(baseInput());
        const uuid = bundleHashToUuidV4(FIXED_BUNDLE_HASH);
        expect(manifest.extra.scopeKey).toBe(`@anonymous/onlook-preview-${uuid}`);
    });

    test("metadata is passed through unchanged", () => {
        const customMetadata: Record<string, unknown> = {
            branch: "main",
            commit: "deadbeef",
        };
        const manifest = buildManifest(
            baseInput({ fields: baseFields({ metadata: customMetadata }) }),
        );
        expect(manifest.metadata).toEqual(customMetadata);
    });

    test("runtimeVersion is passed through verbatim", () => {
        const manifest = buildManifest(
            baseInput({ fields: baseFields({ runtimeVersion: "exposdk:54.0.0" }) }),
        );
        expect(manifest.runtimeVersion).toBe("exposdk:54.0.0");
    });

    test("ios + android manifests share the same id, runtimeVersion, metadata, scopeKey", () => {
        const a = buildManifest(baseInput({ platform: "android" }));
        const i = buildManifest(baseInput({ platform: "ios" }));
        expect(i.id).toBe(a.id);
        expect(i.runtimeVersion).toBe(a.runtimeVersion);
        expect(i.metadata).toEqual(a.metadata);
        expect(i.extra.scopeKey).toBe(a.extra.scopeKey);
        expect(i.extra.expoClient.hostUri).toBe(a.extra.expoClient.hostUri);
        // launchAsset.url differs by platform.
        expect(i.launchAsset.url).not.toBe(a.launchAsset.url);
    });

    test("relayHostUri falls back to cfEsmCacheUrl host when omitted", () => {
        const manifest = buildManifest({
            bundleHash: FIXED_BUNDLE_HASH,
            cfEsmCacheUrl: "https://cf-esm-cache.example.com",
            fields: baseFields(),
            builtAt: FIXED_BUILT_AT,
        });
        expect(manifest.extra.expoClient.hostUri).toBe("cf-esm-cache.example.com");
        expect(manifest.extra.expoGo.debuggerHost).toBe("cf-esm-cache.example.com");
    });
});
