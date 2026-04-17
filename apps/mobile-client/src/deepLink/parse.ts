/**
 * Deep link parser for the Onlook mobile client.
 *
 * Parses `onlook://` URLs into a typed object validated by Zod.
 * Used by the deep link handler (MC3.4) and the QR barcode callback (MC3.7).
 *
 * Task: MC3.3
 */

import { z } from 'zod';

/**
 * Zod schema for a parsed Onlook deep link.
 *
 * - `action`    — the URL hostname/path, e.g. `launch`, `settings`
 * - `sessionId` — optional `session` query param
 * - `relay`     — optional `relay` query param (the cf-expo-relay URL)
 */
export const ParsedDeepLinkSchema = z.object({
    action: z.string().min(1),
    sessionId: z.string().optional(),
    relay: z.string().url().optional(),
});

export type ParsedDeepLink = z.infer<typeof ParsedDeepLinkSchema>;

const ONLOOK_SCHEME = 'onlook:';
const EXPO_SCHEME = 'exp:';

/**
 * Parse an Onlook deep-link URL (or an Expo-Go-compatible `exp://` URL
 * produced by the editor's QR modal for backward compatibility) into a
 * typed {@link ParsedDeepLink} object. Returns `null` for unrecognized
 * schemes, malformed input, or if the parsed result fails Zod validation.
 *
 * Two schemes are accepted:
 *
 * - `onlook://` — the native scheme we registered in Info.plist. Carries
 *   `?session=...&relay=...` query params, with the action on the
 *   hostname.
 * - `exp://host:port/manifest/<hash>` — Expo's own manifest URL scheme.
 *   The editor's cf-expo-relay serves manifests at this path, so when a
 *   user scans an Expo-Go-style QR from the editor, we treat the whole
 *   URL as the relay address and the trailing hash as the session id.
 *   This lets the same editor QR work with both Expo Go AND our custom
 *   client with no editor-side change.
 *
 * @example
 * ```ts
 * parseOnlookDeepLink('onlook://launch?session=abc&relay=http://localhost:8787')
 * // => { action: 'launch', sessionId: 'abc', relay: 'http://localhost:8787' }
 *
 * parseOnlookDeepLink('exp://192.168.0.8:8787/manifest/c6e69884...')
 * // => { action: 'launch', sessionId: 'c6e69884...',
 * //      relay: 'http://192.168.0.8:8787/manifest/c6e69884...' }
 *
 * parseOnlookDeepLink('https://example.com')
 * // => null
 * ```
 */
export function parseOnlookDeepLink(url: string): ParsedDeepLink | null {
    if (!url) {
        return null;
    }

    let parsed: URL;
    try {
        parsed = new URL(url);
    } catch {
        return null;
    }

    // Expo Go scheme: exp://host:port/manifest/<sessionHash>. Normalize to
    // the onlook shape so downstream consumers don't care which QR form
    // the user scanned.
    if (parsed.protocol === EXPO_SCHEME) {
        const trimmed = parsed.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
        const segments = trimmed.split('/');
        if (segments.length < 2 || segments[0] !== 'manifest') {
            return null;
        }
        const sessionId = segments[segments.length - 1];
        if (!sessionId) {
            return null;
        }
        if (/[\u0000-\u001f\u007f]/.test(sessionId)) {
            return null;
        }
        const relayHost = parsed.host; // host:port
        const relay = `http://${relayHost}/manifest/${sessionId}`;
        const candidate = { action: 'launch', sessionId, relay };
        const expoResult = ParsedDeepLinkSchema.safeParse(candidate);
        return expoResult.success ? expoResult.data : null;
    }

    // Only accept the `onlook:` scheme past this point.
    if (parsed.protocol !== ONLOOK_SCHEME) {
        return null;
    }

    // The "action" is the hostname. For `onlook://launch?...` the hostname is
    // `launch`. For `onlook://settings` it is `settings`. If there is a
    // pathname beyond `/`, append it (e.g. `onlook://deep/path` would yield
    // `deep/path`), but strip any trailing slash.
    let action = parsed.hostname;
    const pathname = parsed.pathname.replace(/^\/+/, '').replace(/\/+$/, '');
    if (pathname) {
        action = `${action}/${pathname}`;
    }

    if (!action) {
        return null;
    }

    // Extract known query parameters. Values are automatically URL-decoded by
    // the URL API.
    const sessionId = parsed.searchParams.get('session') ?? undefined;
    const relay = parsed.searchParams.get('relay') ?? undefined;

    // Reject sessionId containing C0 control characters (e.g. NUL, \r, \n).
    // The URL parser strips \n and \r from raw input but decoded query values
    // may still contain them (and NUL is preserved). Control chars in the
    // sessionId indicate malformed or malicious input and must not be passed
    // through to downstream consumers (JSI bindings, relay URLs).
    if (sessionId !== undefined && /[\u0000-\u001f\u007f]/.test(sessionId)) {
        return null;
    }

    const candidate = {
        action,
        ...(sessionId !== undefined && { sessionId }),
        ...(relay !== undefined && { relay }),
    };

    // Validate against the Zod schema. If the relay URL is present but
    // malformed, this will return null rather than an invalid object.
    const result = ParsedDeepLinkSchema.safeParse(candidate);
    if (!result.success) {
        return null;
    }

    return result.data;
}
