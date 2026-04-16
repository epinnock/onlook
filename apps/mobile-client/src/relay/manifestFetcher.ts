/**
 * Manifest fetcher for the Onlook mobile client.
 *
 * Fetches an Expo Updates v2 manifest from the cf-expo-relay and validates it
 * against the Zod schema from `@onlook/mobile-client-protocol`. The relay
 * serves `GET /manifest/:bundleHash` as a `multipart/mixed` response (required
 * by Expo Go SDK 50+ for the dev-server signature bypass), so this module
 * extracts the JSON manifest part from the multipart envelope before parsing.
 *
 * Returns a discriminated-union result (`ManifestResult`) so the caller
 * (MC3.14's relay client) can pattern-match on `ok` without try/catch.
 *
 * Task: MC3.11
 */

import { ManifestSchema } from '@onlook/mobile-client-protocol';
import type { Manifest } from '@onlook/mobile-client-protocol';

/** Discriminated-union result type for manifest fetching. */
export type ManifestResult =
    | { ok: true; manifest: Manifest }
    | { ok: false; error: string };

/**
 * Extract the JSON manifest body from a `multipart/mixed` response.
 *
 * The relay wraps the manifest in a multipart envelope:
 * ```
 * --<boundary>
 * Content-Disposition: form-data; name="manifest"
 * Content-Type: application/json
 *
 * { ...json... }
 * --<boundary>--
 * ```
 *
 * If the response is plain `application/json` (e.g. from the legacy
 * `/session/:id/manifest` endpoint), fall through and return the body as-is.
 */
function extractManifestJson(contentType: string, body: string): string {
    if (contentType.includes('multipart/mixed')) {
        // Grab everything between the manifest part headers and the next boundary.
        const match = body.match(
            /name="manifest"[\r\n]+Content-Type:[^\r\n]+\r?\n\r?\n([\s\S]*?)\r?\n--/,
        );
        if (!match?.[1]) {
            throw new Error('Failed to extract manifest from multipart response');
        }
        return match[1];
    }
    // Plain JSON response — return the full body.
    return body;
}

/**
 * Fetch and validate the Expo manifest from a relay host.
 *
 * @param relayHost - Full URL of the relay manifest endpoint, e.g.
 *   `https://expo-relay.onlook.workers.dev/manifest/<bundleHash>` or
 *   `http://192.168.0.14:8787/manifest/<hash>`.
 *
 * @returns A `ManifestResult` — `{ ok: true, manifest }` on success, or
 *   `{ ok: false, error }` on network error, non-200 status, JSON parse
 *   failure, or Zod validation failure. Never throws.
 */
export async function fetchManifest(relayHost: string): Promise<ManifestResult> {
    let response: Response;
    try {
        response = await fetch(relayHost, {
            method: 'GET',
            headers: {
                Accept: 'multipart/mixed,application/expo+json,application/json',
            },
        });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: `Network error: ${message}` };
    }

    if (!response.ok) {
        return {
            ok: false,
            error: `HTTP ${response.status}: ${response.statusText}`,
        };
    }

    let body: string;
    try {
        body = await response.text();
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: `Failed to read response body: ${message}` };
    }

    let jsonString: string;
    try {
        jsonString = extractManifestJson(
            response.headers.get('content-type') ?? '',
            body,
        );
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: message };
    }

    let json: unknown;
    try {
        json = JSON.parse(jsonString);
    } catch {
        return { ok: false, error: 'Invalid JSON in manifest response' };
    }

    const result = ManifestSchema.safeParse(json);
    if (!result.success) {
        return {
            ok: false,
            error: `Manifest validation failed: ${result.error.message}`,
        };
    }

    return { ok: true, manifest: result.data };
}
