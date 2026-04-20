import { NextRequest, NextResponse } from 'next/server';

import { env } from '@/env';
import { createClient } from '@/utils/supabase/server';
import { SpectraConfigError, type SpectraClient } from '~/server/spectra/client';
import { createSpectraClient } from '~/server/spectra/factory';
import { assertOwnership, touchSession } from '~/server/spectra/registry';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Streams Spectra's `multipart/x-mixed-replace` MJPEG feed through Next.js
 * so the browser never learns SPECTRA_API_URL or the optional bearer
 * token, and so CORS is a non-issue. Each open connection holds a socket
 * to Spectra for the duration of the view.
 *
 * The `<img src>` tag in the canvas simulator view consumes this exactly
 * like Spectra's own dashboard — same wire format, just proxied.
 */
export async function GET(
    req: NextRequest,
    { params }: { params: Promise<{ sessionId: string }> },
): Promise<Response> {
    if (!env.NEXT_PUBLIC_FEATURE_SPECTRA_PREVIEW) {
        return NextResponse.json({ error: 'Spectra preview is not enabled' }, { status: 404 });
    }
    if (!env.SPECTRA_API_URL) {
        return NextResponse.json({ error: 'SPECTRA_API_URL is not configured' }, { status: 503 });
    }

    const supabase = await createClient();
    const {
        data: { user },
        error,
    } = await supabase.auth.getUser();
    if (error || !user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { sessionId } = await params;
    try {
        assertOwnership(user.id, sessionId);
    } catch {
        return NextResponse.json({ error: 'Session not found or not owned by this user' }, { status: 403 });
    }
    touchSession(sessionId);

    let client: SpectraClient;
    try {
        client = createSpectraClient();
    } catch (err) {
        if (err instanceof SpectraConfigError) {
            return NextResponse.json({ error: err.message }, { status: 503 });
        }
        throw err;
    }

    const upstream = await fetch(client.mjpegUrl(sessionId), {
        method: 'GET',
        headers: client.authHeaders,
        signal: req.signal,
    });

    if (!upstream.ok || !upstream.body) {
        const text = await upstream.text().catch(() => '');
        return NextResponse.json(
            {
                error: `Upstream MJPEG stream not available (${upstream.status})`,
                detail: text.slice(0, 500),
            },
            { status: 502 },
        );
    }

    const contentType =
        upstream.headers.get('content-type') ??
        'multipart/x-mixed-replace; boundary=--spectra-mjpeg-boundary';

    return new Response(upstream.body, {
        status: 200,
        headers: {
            'Content-Type': contentType,
            'Cache-Control': 'no-store, no-cache, must-revalidate',
            Pragma: 'no-cache',
            Connection: 'keep-alive',
        },
    });
}
