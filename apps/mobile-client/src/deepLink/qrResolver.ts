/**
 * QR barcode callback to deep link resolver.
 *
 * Takes raw barcode data from the QR scanner (MC3.6), validates it via
 * {@link parseOnlookDeepLink} (MC3.3), and resolves it into a session
 * connection action or a descriptive error.
 *
 * Task: MC3.7
 */

import { parseOnlookDeepLink } from './parse';

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

export type QrResolveResult =
    | { ok: true; sessionId: string; relay: string }
    | { ok: false; error: string };

// ---------------------------------------------------------------------------
// Core resolver
// ---------------------------------------------------------------------------

/**
 * Resolve a raw barcode string into a session connection action.
 *
 * 1. Delegates to {@link parseOnlookDeepLink} — if that returns `null` the
 *    barcode was not an `onlook://` URL and we return an error.
 * 2. If the parsed result is missing `sessionId` or `relay` we return an error
 *    (both are required for a session connection).
 * 3. Otherwise we return `{ ok: true, sessionId, relay }`.
 */
export function resolveQrCode(barcodeData: string): QrResolveResult {
    const parsed = parseOnlookDeepLink(barcodeData);

    if (parsed === null) {
        return { ok: false, error: 'Not an Onlook QR code' };
    }

    if (!parsed.sessionId || !parsed.relay) {
        return { ok: false, error: 'QR code missing session or relay info' };
    }

    return { ok: true, sessionId: parsed.sessionId, relay: parsed.relay };
}

// ---------------------------------------------------------------------------
// React hook (thin seam for future async validation)
// ---------------------------------------------------------------------------

/**
 * Hook that exposes the QR resolver. Currently a trivial wrapper around
 * {@link resolveQrCode} but provides a stable API surface for adding async
 * validation, analytics, or retry logic later.
 */
export function useQrResolver(): { resolve: (data: string) => QrResolveResult } {
    return { resolve: resolveQrCode };
}
