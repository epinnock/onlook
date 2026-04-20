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
    reloadBundle?: (bundleSource: string) => void;
};

/** Stage names used to tag failures in {@link QrMountResult}. */
export type QrMountStage = 'parse' | 'manifest' | 'bundle' | 'mount';

/**
 * Module-level flag tracking whether `OnlookRuntime.runApplication` has
 * already been invoked for the lifetime of this JS context.
 *
 * The C++ binding (MC2.7) assumes a first-time mount: it evaluates the
 * bundle and calls `globalThis.onlookMount(props)` without tearing down any
 * prior React tree. Calling it twice therefore produces a stale / broken
 * UI and — depending on the bundle — can throw during `onlookMount`.
 *
 * MC2.8's `reloadBundle(bundleSource)` is the supported path for the
 * second-and-later scan: it runs `globalThis.onlookUnmount()` then re-runs
 * the bundle eval. We flip this flag on the first successful mount so every
 * subsequent `qrToMount` call routes through the reload path.
 *
 * Exported only for tests — production code must not mutate it directly.
 */
let hasMountedApplication = false;

/**
 * @internal Test-only helper to reset the "already mounted" flag between
 * harness runs. Not exported from the package barrel.
 */
export function __resetQrToMountState(): void {
    hasMountedApplication = false;
}

/**
 * Discriminated-union result of the QR-to-mount pipeline. On success the
 * caller receives the `sessionId` for subsequent WebSocket connection and
 * inspector wiring. On failure the `stage` field identifies where the
 * pipeline stopped so the UI can route to the right error screen.
 */
export type QrMountResult =
    | { ok: true; sessionId: string; relay: string }
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
    // Redact any long tokens but keep scheme + path + known params for diagnosis.
    const redacted = barcodeData.length > 300 ? barcodeData.slice(0, 300) + '…' : barcodeData;
    console.log(`${LOG_PREFIX} stage=parse barcode=${redacted}`);

    // ── Stage 1: parse ────────────────────────────────────────────────────
    const parsed = parseOnlookDeepLink(barcodeData);
    if (parsed === null || !parsed.sessionId || !parsed.relay) {
        console.log(`${LOG_PREFIX} stage=parse result=null (invalid onlook URL)`);
        return {
            ok: false,
            stage: 'parse',
            error: 'Not an Onlook QR code',
        };
    }

    const { sessionId, relay } = parsed;
    console.log(`${LOG_PREFIX} stage=parse ok sessionId=${sessionId} relay=${relay}`);

    // ── Stage 2: manifest ─────────────────────────────────────────────────
    console.log(`${LOG_PREFIX} stage=manifest GET ${relay}`);
    const manifestResult = await fetchManifest(relay);
    if (!manifestResult.ok) {
        console.log(`${LOG_PREFIX} stage=manifest FAIL ${manifestResult.error}`);
        return {
            ok: false,
            stage: 'manifest',
            error: manifestResult.error,
        };
    }

    const bundleUrl = manifestResult.manifest.launchAsset.url;
    console.log(`${LOG_PREFIX} stage=manifest ok bundleUrl=${bundleUrl}`);

    // ── Stage 3: bundle ───────────────────────────────────────────────────
    console.log(`${LOG_PREFIX} stage=bundle GET ${bundleUrl}`);
    const bundleResult = await fetchBundle(bundleUrl);
    if (!bundleResult.ok) {
        console.log(`${LOG_PREFIX} stage=bundle FAIL ${bundleResult.error}`);
        return {
            ok: false,
            stage: 'bundle',
            error: bundleResult.error,
        };
    }
    console.log(`${LOG_PREFIX} stage=bundle ok bytes=${bundleResult.source.length}`);

    // ── Stage 4: mount ────────────────────────────────────────────────────
    //
    // First scan in this JS context → `runApplication` (fresh mount).
    // Second-and-later scans    → `reloadBundle` (MC2.8 — tears down the
    // existing React tree then re-runs the bundle eval). Calling
    // `runApplication` a second time leaves the prior tree intact and
    // silently produces a broken UI — see MCF-BUG-QR-SUBSEQUENT.
    const runtime = (globalThis as { OnlookRuntime?: OnlookRuntimeWithRunApplication })
        .OnlookRuntime;

    if (!hasMountedApplication) {
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
            console.log(`${LOG_PREFIX} stage=mount runApplication() bytes=${bundleResult.source.length}`);
            runApplication(bundleResult.source, { sessionId });
            console.log(`${LOG_PREFIX} stage=mount runApplication() returned`);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            const stack = err instanceof Error && err.stack ? err.stack : '';
            console.log(`${LOG_PREFIX} stage=mount runApplication THREW ${message}`);
            if (stack) console.log(`${LOG_PREFIX} stack=${stack.slice(0, 800)}`);
            return {
                ok: false,
                stage: 'mount',
                error: `runApplication threw: ${message}`,
            };
        }

        hasMountedApplication = true;
    } else {
        const reloadBundle = runtime?.reloadBundle;
        if (typeof reloadBundle !== 'function') {
            console.log(
                `${LOG_PREFIX} OnlookRuntime.reloadBundle not yet available (MC2.8 pending)`,
            );
            return {
                ok: false,
                stage: 'mount',
                error: 'OnlookRuntime.reloadBundle not yet available (MC2.8 pending)',
            };
        }

        try {
            reloadBundle(bundleResult.source);
        } catch (err: unknown) {
            const message = err instanceof Error ? err.message : String(err);
            return {
                ok: false,
                stage: 'mount',
                error: `reloadBundle threw: ${message}`,
            };
        }
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

    return { ok: true, sessionId, relay };
}
