/**
 * QR-to-mount end-to-end flow for the Onlook mobile client.
 *
 * Bundles the four pipeline stages a user triggers by scanning an Onlook QR
 * code into a single callable function. Each stage returns an early
 * discriminated-union failure tagged with the stage name so the UI layer can
 * pick an appropriate error surface (toast, screen, etc.) without unpacking
 * stack traces.
 *
 * Pipeline:
 *   1. parse    — {@link parseOnlookDeepLink} (MC3.3): validate the raw
 *                 barcode string and pull out `sessionId` + `relay`.
 *   2. manifest — {@link fetchManifest} (MC3.11): GET the Expo Updates v2
 *                 manifest from the relay and validate against the Zod
 *                 schema.
 *   3. bundle   — {@link fetchBundle} (MC3.12): GET the JS bundle pointed at
 *                 by `manifest.launchAsset.url`.
 *   4. mount    — `globalThis.OnlookRuntime.runApplication` (MC2.7,
 *                 currently pending): evaluate the bundle inside the JSI
 *                 binding with `{ sessionId }` injected as props.
 *
 * On a successful mount, the session is persisted via
 * {@link addRecentSession} (MC3.8) so the launcher can show it in the
 * recents list on the next launch.
 *
 * Task: MC3.21
 */

import { parseOnlookDeepLink } from '../deepLink/parse';
import { fetchBundle } from '../relay/bundleFetcher';
import { fetchManifest } from '../relay/manifestFetcher';
import { addRecentSession } from '../storage/recentSessions';

/**
 * Local shape of the `OnlookRuntime` JSI binding this flow uses. Other
 * modules (e.g. `actions/reloadBundle.ts`) `declare global` a narrower
 * shape; we read `OnlookRuntime` through a typed cast here to avoid
 * conflicting ambient declarations.
 */
type OnlookRuntimeWithRunApplication = {
    runApplication?: (
        bundleSource: string,
        props: { sessionId: string },
    ) => void;
};

/** Stage names used to tag failures in {@link QrMountResult}. */
export type QrMountStage = 'parse' | 'manifest' | 'bundle' | 'mount';

/**
 * Discriminated-union result of the QR-to-mount pipeline. On success the
 * caller receives the `sessionId` for subsequent WebSocket connection and
 * inspector wiring. On failure the `stage` field identifies where the
 * pipeline stopped so the UI can route to the right error screen.
 */
export type QrMountResult =
    | { ok: true; sessionId: string }
    | { ok: false; stage: QrMountStage; error: string };

const LOG_PREFIX = '[qrToMount]';

/**
 * Drive the full QR → mount pipeline from a raw barcode payload.
 *
 * Errors are returned — never thrown — so callers can pattern-match on
 * `result.ok`. Each failure case carries the stage that produced it plus a
 * human-readable error string.
 */
export async function qrToMount(barcodeData: string): Promise<QrMountResult> {
    // ── Stage 1: parse ────────────────────────────────────────────────────
    const parsed = parseOnlookDeepLink(barcodeData);
    if (parsed === null || !parsed.sessionId || !parsed.relay) {
        return {
            ok: false,
            stage: 'parse',
            error: 'Not an Onlook QR code',
        };
    }

    const { sessionId, relay } = parsed;

    // ── Stage 2: manifest ─────────────────────────────────────────────────
    const manifestResult = await fetchManifest(relay);
    if (!manifestResult.ok) {
        return {
            ok: false,
            stage: 'manifest',
            error: manifestResult.error,
        };
    }

    const bundleUrl = manifestResult.manifest.launchAsset.url;

    // ── Stage 3: bundle ───────────────────────────────────────────────────
    const bundleResult = await fetchBundle(bundleUrl);
    if (!bundleResult.ok) {
        return {
            ok: false,
            stage: 'bundle',
            error: bundleResult.error,
        };
    }

    // ── Stage 4: mount ────────────────────────────────────────────────────
    const runtime = (globalThis as { OnlookRuntime?: OnlookRuntimeWithRunApplication })
        .OnlookRuntime;
    const runApplication = runtime?.runApplication;
    if (typeof runApplication !== 'function') {
        console.log(
            `${LOG_PREFIX} OnlookRuntime.runApplication not yet available (MC2.7 pending)`,
        );
        return {
            ok: false,
            stage: 'mount',
            error: 'OnlookRuntime.runApplication not yet available (MC2.7 pending)',
        };
    }

    try {
        runApplication(bundleResult.source, { sessionId });
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return {
            ok: false,
            stage: 'mount',
            error: `runApplication threw: ${message}`,
        };
    }

    // ── Persist session on successful mount (MC3.8) ───────────────────────
    try {
        await addRecentSession({
            sessionId,
            relayHost: relay,
            lastConnected: new Date().toISOString(),
        });
    } catch (err: unknown) {
        // Non-fatal: the bundle is already mounted. Log and continue.
        const message = err instanceof Error ? err.message : String(err);
        console.warn(`${LOG_PREFIX} failed to persist recent session: ${message}`);
    }

    return { ok: true, sessionId };
}
