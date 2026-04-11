/**
 * Pure helpers for building the public manifest URL that Expo Go scans.
 *
 * The URL layout is owned by `apps/cf-expo-relay` — see TQ1.2 (`routes/manifest.ts`)
 * which exposes `GET /manifest/:bundleHash`. This module is intentionally
 * free of I/O and framework dependencies so it can be used both from client
 * components (QR rendering) and from tRPC resolvers.
 *
 * **HTTP vs exp:// scheme.** Expo Go's QR scanner deep-link handler is wired
 * to `exp://` (and `exps://` for HTTPS) URIs. Scanning a plain `http://` URL
 * with the in-app QR scanner falls through to the OS browser instead of
 * loading the project. The fix is to flip the URL scheme before encoding
 * into the QR. The actual transport stays HTTP — Expo Go translates
 * `exp://host:port/path` to `http://host:port/path` (and `exps://` to
 * `https://`) when fetching the manifest.
 */

export interface ManifestUrlOptions {
    /** Base URL of cf-expo-relay (e.g. http://192.168.1.42:8787 for LAN dev). */
    relayBaseUrl: string;
    /**
     * URL scheme of the returned URL. Defaults to `'expo'` because every
     * existing caller (the QR renderer + the legacy ExpoQrButton clipboard
     * copy) wants the Expo-Go-deep-linkable form. Pass `'http'` to keep
     * the original transport scheme — useful for diagnostic curl tests
     * and the unit tests below.
     */
    scheme?: 'expo' | 'http';
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
 *
 * Default `scheme: 'expo'`:
 *   `http://192.168.1.42:8787` → `exp://192.168.1.42:8787/manifest/<hash>`
 *   `https://relay.example.com` → `exps://relay.example.com/manifest/<hash>`
 *
 * Override with `scheme: 'http'` to get the raw transport URL (used by
 * unit tests and any diagnostic that wants to curl the relay directly).
 */
export function buildManifestUrl(bundleHash: string, opts: ManifestUrlOptions): string {
    validateBundleHash(bundleHash);
    const base = stripTrailingSlash(opts.relayBaseUrl);
    const scheme = opts.scheme ?? 'expo';
    if (scheme === 'http') {
        return `${base}/manifest/${bundleHash}`;
    }
    return `${toExpoScheme(base)}/manifest/${bundleHash}`;
}

/**
 * Convert an `http://` or `https://` base URL to its Expo-Go-deep-linkable
 * `exp://` or `exps://` equivalent. Anything not matching either prefix is
 * returned unchanged (defensive — covers a hand-crafted `exp://` base or
 * a relative URL that already lacks a scheme).
 */
export function toExpoScheme(baseUrl: string): string {
    if (baseUrl.startsWith('https://')) {
        return `exps://${baseUrl.slice('https://'.length)}`;
    }
    if (baseUrl.startsWith('http://')) {
        return `exp://${baseUrl.slice('http://'.length)}`;
    }
    return baseUrl;
}

function stripTrailingSlash(url: string): string {
    return url.endsWith('/') ? url.slice(0, -1) : url;
}
