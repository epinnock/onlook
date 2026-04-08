/// <reference types="bun" />
import { describe, expect, test } from "bun:test";

import {
    buildManifest,
    type BuildManifestInput,
    type ExpoManifest,
    type ManifestFields,
} from "../manifest-builder";

/** A canonical empty-asset fields payload mirroring the Phase Q seed fixture. */
function baseFields(overrides: Partial<ManifestFields> = {}): ManifestFields {
    return {
        runtimeVersion: "1.0.0",
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
const FIXED_BUILT_AT = "2026-04-07T21:00:00.000Z";

function baseInput(overrides: Partial<BuildManifestInput> = {}): BuildManifestInput {
    return {
        bundleHash: FIXED_BUNDLE_HASH,
        cfEsmCacheUrl: FIXED_CACHE_URL,
        fields: baseFields(),
        builtAt: FIXED_BUILT_AT,
        ...overrides,
    };
}

describe("buildManifest", () => {
    test("minimal manifest matches the canonical TQ0.2 example shape", () => {
        const manifest = buildManifest(baseInput());

        const expected: ExpoManifest = {
            id: FIXED_BUNDLE_HASH,
            createdAt: FIXED_BUILT_AT,
            runtimeVersion: "1.0.0",
            launchAsset: {
                key: "bundle-c6a1fbc03d4e7f1234567890abcdef0123456789abcdef0123456789abcdef01",
                contentType: "application/javascript",
                url: `${FIXED_CACHE_URL}/bundle/${FIXED_BUNDLE_HASH}/index.android.bundle`,
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
        };

        expect(manifest).toEqual(expected);
    });

    test("id equals bundleHash", () => {
        const manifest = buildManifest(baseInput({ bundleHash: "deadbeef" }));
        expect(manifest.id).toBe("deadbeef");
    });

    test("launchAsset.url includes the bundleHash", () => {
        const manifest = buildManifest(baseInput({ bundleHash: "abc123" }));
        expect(manifest.launchAsset.url).toContain("abc123");
        expect(manifest.launchAsset.url).toBe(
            "https://cf-esm-cache.dev.workers.dev/bundle/abc123/index.android.bundle",
        );
    });

    test("assets[].url is computed from cache URL, bundleHash, key, and fileExtension", () => {
        const manifest = buildManifest({
            bundleHash: "abc123",
            cfEsmCacheUrl: "https://x.workers.dev",
            fields: baseFields({
                assets: [
                    {
                        key: "def456",
                        contentType: "image/png",
                        fileExtension: ".png",
                    },
                ],
            }),
            builtAt: FIXED_BUILT_AT,
        });

        expect(manifest.assets).toHaveLength(1);
        const asset = manifest.assets[0];
        expect(asset).toBeDefined();
        expect(asset?.url).toBe("https://x.workers.dev/bundle/abc123/def456.png");
        expect(asset?.key).toBe("def456");
        expect(asset?.contentType).toBe("image/png");
        expect(asset?.fileExtension).toBe(".png");
    });

    test("trailing slash on cfEsmCacheUrl is stripped", () => {
        const manifest = buildManifest({
            bundleHash: "abc123",
            cfEsmCacheUrl: "https://x.workers.dev/",
            fields: baseFields({
                assets: [
                    {
                        key: "def456",
                        contentType: "image/png",
                        fileExtension: ".png",
                    },
                ],
            }),
            builtAt: FIXED_BUILT_AT,
        });

        expect(manifest.launchAsset.url).toBe(
            "https://x.workers.dev/bundle/abc123/index.android.bundle",
        );
        expect(manifest.launchAsset.url).not.toContain("//bundle");
        expect(manifest.assets[0]?.url).toBe(
            "https://x.workers.dev/bundle/abc123/def456.png",
        );
        expect(manifest.assets[0]?.url).not.toContain("//bundle");
    });

    test("extra is passed through unchanged", () => {
        const fields = baseFields();
        const manifest = buildManifest(baseInput({ fields }));
        expect(manifest.extra).toEqual(fields.extra);
    });

    test("metadata is passed through unchanged", () => {
        const customMetadata: Record<string, unknown> = {
            branch: "main",
            commit: "deadbeef",
            nested: { foo: 1, bar: [true, false] },
        };
        const manifest = buildManifest(
            baseInput({ fields: baseFields({ metadata: customMetadata }) }),
        );
        expect(manifest.metadata).toEqual(customMetadata);
    });

    test("runtimeVersion is passed through unchanged", () => {
        const manifest = buildManifest(
            baseInput({
                fields: baseFields({ runtimeVersion: "exposdk:54.0.0" }),
            }),
        );
        expect(manifest.runtimeVersion).toBe("exposdk:54.0.0");
    });

    test("createdAt defaults to a parseable ISO string when not provided", () => {
        const before = Date.now();
        const manifest = buildManifest({
            bundleHash: FIXED_BUNDLE_HASH,
            cfEsmCacheUrl: FIXED_CACHE_URL,
            fields: baseFields(),
        });
        const after = Date.now();

        const parsed = Date.parse(manifest.createdAt);
        expect(Number.isNaN(parsed)).toBe(false);
        expect(parsed).toBeGreaterThanOrEqual(before);
        expect(parsed).toBeLessThanOrEqual(after);
        // Round-trips through Date as a strict ISO-8601 string.
        expect(new Date(parsed).toISOString()).toBe(manifest.createdAt);
    });

    test("createdAt is used verbatim when provided", () => {
        const manifest = buildManifest(
            baseInput({ builtAt: "2025-12-31T23:59:59.999Z" }),
        );
        expect(manifest.createdAt).toBe("2025-12-31T23:59:59.999Z");
    });
});
