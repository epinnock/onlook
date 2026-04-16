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

/**
 * Parse an `onlook://` deep-link URL into a typed {@link ParsedDeepLink}
 * object. Returns `null` for non-onlook URLs, malformed input, or if the
 * parsed result fails Zod validation.
 *
 * @example
 * ```ts
 * parseOnlookDeepLink('onlook://launch?session=abc&relay=http://localhost:8787')
 * // => { action: 'launch', sessionId: 'abc', relay: 'http://localhost:8787' }
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

    // Only accept the `onlook:` scheme.
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
