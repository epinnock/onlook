import { type NextRequest, NextResponse } from 'next/server';

/**
 * Proxies MCP App resource fetches to avoid CORS issues.
 * The browser can't fetch widget HTML directly from cross-origin MCP servers,
 * so this route fetches it server-side and returns it.
 */
export async function GET(request: NextRequest) {
    const url = request.nextUrl.searchParams.get('url');

    if (!url) {
        return NextResponse.json({ error: 'Missing url parameter' }, { status: 400 });
    }

    // Allow HTTPS and HTTP (for local/dev MCP servers)
    if (!url.startsWith('https://') && !url.startsWith('http://')) {
        return NextResponse.json({ error: 'Only HTTP/HTTPS URLs are allowed' }, { status: 400 });
    }

    try {
        const response = await fetch(url, {
            headers: { 'Accept': 'text/html' },
        });

        if (!response.ok) {
            return NextResponse.json(
                { error: `Upstream returned ${response.status}` },
                { status: response.status },
            );
        }

        const html = await response.text();

        return new NextResponse(html, {
            headers: {
                'Content-Type': 'text/html; charset=utf-8',
                'Cache-Control': 'public, max-age=3600',
            },
        });
    } catch (err) {
        return NextResponse.json(
            { error: `Failed to fetch resource: ${err}` },
            { status: 502 },
        );
    }
}
