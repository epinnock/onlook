// Short-circuit /v1/runners — Cursor IDE (and some Anthropic SDK
// shims) preflight this path when localhost ports are open. Without
// this handler, every OPTIONS preflight triggers a full Next.js
// compile of the not-found page, which piles up behind the middleware
// chain and tanks dev-server latency (observed 4+ min per request).
//
// Returning a dedicated 404 immediately keeps the dev server
// responsive. No production effect — `/v1/runners` isn't an Onlook
// API surface.

const NOT_FOUND = new Response(null, {
    status: 404,
    headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': '*',
        'Cache-Control': 'public, max-age=3600',
    },
});

export function OPTIONS(): Response {
    return NOT_FOUND.clone();
}

export function GET(): Response {
    return NOT_FOUND.clone();
}

export function POST(): Response {
    return NOT_FOUND.clone();
}
