import { NextRequest, NextResponse } from 'next/server';

import { env } from '@/env';
import { createClient } from '@/utils/supabase/server';
import { SpectraClient, SpectraConfigError } from '~/server/spectra/client';
import { assertOwnership, dropSession } from '~/server/spectra/registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Best-effort end-session endpoint for `navigator.sendBeacon`.
 *
 * The browser can't use a tRPC mutation during `beforeunload` — the fetch
 * would be torn down by the page transition. `sendBeacon` fires and forgets,
 * so we expose a tiny POST route that:
 *   1. Reads `sessionId` from the query string,
 *   2. Verifies ownership via the registry,
 *   3. Drops the registry entry AND fires `DELETE /v1/devices/:id` on
 *      Spectra — both best-effort, errors swallowed because the caller has
 *      already navigated away and can't see any response.
 */
export async function POST(req: NextRequest): Promise<Response> {
    if (!env.NEXT_PUBLIC_FEATURE_SPECTRA_PREVIEW || !env.SPECTRA_API_URL) {
        return NextResponse.json({ ok: true }, { status: 200 });
    }

    const sessionId = req.nextUrl.searchParams.get('sessionId');
    if (!sessionId) {
        return NextResponse.json({ error: 'sessionId required' }, { status: 400 });
    }

    const supabase = await createClient();
    const {
        data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
        return NextResponse.json({ ok: true }, { status: 200 });
    }

    try {
        assertOwnership(user.id, sessionId);
    } catch {
        return NextResponse.json({ ok: true }, { status: 200 });
    }

    try {
        const client = new SpectraClient();
        await client.deleteDevice(sessionId).catch(() => undefined);
    } catch (err) {
        if (!(err instanceof SpectraConfigError)) throw err;
    } finally {
        dropSession(sessionId);
    }

    return NextResponse.json({ ok: true });
}
