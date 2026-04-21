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
        // HTTP header names are case-insensitive (RFC 7230 §3.2) — both Expo Go
        // SDK 50+ (Content-Type) and cf-expo-relay running under local Metro
        // (content-type) are seen in the wild. Use /i to accept either.
        const match = body.match(
            /name="manifest"[\r\n]+content-type:[^\r\n]+\r?\n\r?\n([\s\S]*?)\r?\n--/i,
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
/**
 * XHR-based request — bypasses the RN fetch implementation that hangs on
 * `response.text()` in the iOS 18.6 sim even when the upstream response is
 * complete with Content-Length known. RN's XMLHttpRequest goes through
 * RCTNetworking directly and resolves when the full body has arrived, so
 * timers keep firing normally and the Promise settles.
 */
interface XhrResult {
    status: number;
    statusText: string;
    body: string;
    contentType: string;
}

declare const XMLHttpRequest: {
    new (): {
        open(method: string, url: string, async?: boolean): void;
        setRequestHeader(name: string, value: string): void;
        getResponseHeader(name: string): string | null;
        send(body?: string | null): void;
        abort(): void;
        readyState: number;
        status: number;
        statusText: string;
        responseText: string;
        onreadystatechange: (() => void) | null;
        ontimeout: (() => void) | null;
        onerror: ((ev: unknown) => void) | null;
        onabort: (() => void) | null;
        timeout: number;
    };
};

function nlog(msg: string): void {
    // Prefer __onlookDirectLog (installed by cpp/OnlookRuntimeInstaller, a
    // private channel RN's bridge doesn't touch) over nativeLoggingHook
    // (which RN bridgeless appears to overwrite sometime after our native
    // installer runs). Falls through to nativeLoggingHook if the direct
    // channel isn't there yet, then to nothing at all.
    try {
        const gt = globalThis as unknown as {
            __onlookDirectLog?: (m: string, level: number) => void;
            nativeLoggingHook?: (m: string, level: number) => void;
        };
        const channel = gt.__onlookDirectLog ?? gt.nativeLoggingHook;
        channel?.(`[OM-manifest] ${msg}`, 1);
    } catch { /* intentionally swallowed: diagnostic path must never throw */ }
}

function xhrGet(url: string, headers: Record<string, string>, timeoutMs: number): Promise<XhrResult> {
    return new Promise((resolve, reject) => {
        nlog(`xhrGet enter url=${url.slice(0, 120)}`);
        const xhrCtor = (globalThis as unknown as { XMLHttpRequest?: unknown }).XMLHttpRequest;
        nlog(`typeof XMLHttpRequest=${typeof xhrCtor}`);
        const xhr = new XMLHttpRequest();
        nlog('xhr constructed');
        let settled = false;
        const settle = (fn: () => void) => {
            if (settled) return;
            settled = true;
            fn();
        };
        xhr.open('GET', url, true);
        for (const [k, v] of Object.entries(headers)) {
            xhr.setRequestHeader(k, v);
        }
        xhr.timeout = timeoutMs;
        xhr.onreadystatechange = () => {
            nlog(`readyState=${xhr.readyState} status=${xhr.status}`);
            if (xhr.readyState === 4) {
                settle(() =>
                    resolve({
                        status: xhr.status,
                        statusText: xhr.statusText,
                        body: xhr.responseText,
                        contentType: xhr.getResponseHeader('content-type') ?? '',
                    }),
                );
            }
        };
        xhr.ontimeout = () => { nlog('ontimeout'); settle(() => reject(new Error(`XHR timed out after ${timeoutMs}ms`))); };
        xhr.onerror = () => { nlog('onerror'); settle(() => reject(new Error('XHR error'))); };
        xhr.onabort = () => { nlog('onabort'); settle(() => reject(new Error('XHR aborted'))); };
        nlog('xhr.send()');
        xhr.send();
        nlog('xhr.send() returned');
    });
}

/**
 * Fetch the manifest via whatwg-fetch. Used as the test-environment path
 * (bun has no XMLHttpRequest constructor) AND as the default path on any
 * platform where the host's fetch implementation is well-behaved. In the
 * iOS 18.6 sim under Hermes/URLSession, fetch hangs on `response.text()`
 * for keep-alive HTTP/1.1 responses — so sim callers use `xhrGet` below
 * instead. The branch happens via `hasXMLHttpRequest()` in fetchManifest.
 */
async function fetchViaFetch(
    url: string,
    headers: Record<string, string>,
): Promise<XhrResult> {
    const response = await fetch(url, { method: 'GET', headers });
    const body = await response.text();
    return {
        status: response.status,
        statusText: response.statusText,
        body,
        contentType: response.headers.get('content-type') ?? '',
    };
}

/** Env-detect: XMLHttpRequest is provided by RN but not by bun-test. */
function hasXMLHttpRequest(): boolean {
    return (
        typeof (globalThis as { XMLHttpRequest?: unknown }).XMLHttpRequest ===
        'function'
    );
}

export async function fetchManifest(relayHost: string): Promise<ManifestResult> {
    // Request the relay's `?format=json` bypass path so the response is
    // plain `application/json` instead of the multipart/mixed envelope
    // Expo Go expects. Pins `platform=ios` explicitly since the relay
    // defaults to android without an Expo-Platform header.
    const separator = relayHost.includes('?') ? '&' : '?';
    const url = `${relayHost}${separator}format=json&platform=ios`;

    // XHR over fetch on sim; fetch on test/desktop. See xhrGet doc comment
    // for the "why XHR on sim" rationale. Under bun's test harness XMLHttpRequest
    // is absent, so we fall through to the fetch path which exercises
    // `globalThis.fetch` mocks set up by the existing tests.
    let xhr: XhrResult;
    try {
        xhr = hasXMLHttpRequest()
            ? await xhrGet(
                  url,
                  { Accept: 'application/json', 'Expo-Platform': 'ios' },
                  10000,
              )
            : await fetchViaFetch(url, {
                  Accept: 'application/json',
                  'Expo-Platform': 'ios',
              });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { ok: false, error: `Network error: ${message}` };
    }

    if (xhr.status < 200 || xhr.status >= 300) {
        return {
            ok: false,
            error: `HTTP ${xhr.status}: ${xhr.statusText}`,
        };
    }

    const body = xhr.body;
    const contentType = xhr.contentType;

    let jsonString: string;
    try {
        jsonString = extractManifestJson(contentType, body);
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
