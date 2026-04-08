/**
 * Pure helpers for building the public manifest URL that Expo Go scans.
 *
 * The URL layout is owned by `apps/cf-expo-relay` — see TQ1.2 (`routes/manifest.ts`)
 * which exposes `GET /manifest/:bundleHash`. This module is intentionally
 * free of I/O and framework dependencies so it can be used both from client
 * components (QR rendering) and from tRPC resolvers.
 */

export interface ManifestUrlOptions {
    /** Base URL of cf-expo-relay (e.g. http://192.168.1.42:8787 for LAN dev). */
    relayBaseUrl: string;
}

/** 64-char lowercase hex SHA256 — matches the relay route validation. */
const HEX64 = /^[0-9a-f]{64}$/;

/**
 * Validates a hash is a 64-char hex SHA256 string (lowercase).
 * Throws if invalid (matches the cf-expo-relay route validation in TQ1.2).
 */
export function validateBundleHash(hash: string): void {
    if (typeof hash !== 'string' || !HEX64.test(hash)) {
        throw new Error(
            `expo-relay: invalid bundleHash, expected 64-char lowercase hex, got: ${hash}`,
        );
    }
}

/**
 * Builds the URL Expo Go scans from the QR code.
 * Strips trailing slash from relayBaseUrl.
 * Returns: `${relayBaseUrl}/manifest/${bundleHash}`
 */
export function buildManifestUrl(bundleHash: string, opts: ManifestUrlOptions): string {
    validateBundleHash(bundleHash);
    const base = stripTrailingSlash(opts.relayBaseUrl);
    return `${base}/manifest/${bundleHash}`;
}

function stripTrailingSlash(url: string): string {
    return url.endsWith('/') ? url.slice(0, -1) : url;
}
