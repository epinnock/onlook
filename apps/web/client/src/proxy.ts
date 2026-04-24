import { updateSession } from '@/utils/supabase/middleware';
import { type NextRequest } from 'next/server';

export async function proxy(request: NextRequest) {
    // update user's auth session
    return await updateSession(request);
}

export const config = {
    matcher: [
        /*
         * Match all request paths except for the ones starting with:
         * - _next/static (static files)
         * - _next/image (image optimization files)
         * - favicon.ico (favicon file)
         * Feel free to modify this pattern to include more paths.
         */
        // `v1/runners` short-circuits to a dedicated route handler so
        // Cursor-IDE preflight polling doesn't pile up behind the
        // Supabase-session middleware (each hit compiled the not-found
        // page — 4+ min latency under load).
        '/((?!_next/static|_next/image|favicon.ico|v1/runners|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
    ],
};
