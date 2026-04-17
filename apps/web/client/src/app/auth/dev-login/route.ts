import { env } from '@/env';
import { Routes } from '@/utils/constants';
import { createServerClient } from '@supabase/ssr';
import { SEED_USER } from '@onlook/db';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

function resolveReturnPath(requestUrl: URL): string {
    const returnUrl = requestUrl.searchParams.get('returnUrl');

    if (returnUrl && returnUrl.startsWith('/')) {
        return returnUrl;
    }

    return Routes.AUTH_REDIRECT;
}

function isLoopbackHost(hostname: string): boolean {
    return hostname === '127.0.0.1' || hostname === 'localhost';
}

function resolveRequestOrigin(request: Request): string {
    const requestUrl = new URL(request.url);
    const host = request.headers.get('host');

    if (!host) {
        return requestUrl.origin;
    }

    return `${requestUrl.protocol}//${host}`;
}

export async function GET(request: Request) {
    const requestUrl = new URL(request.url);
    const redirectPath = resolveReturnPath(requestUrl);
    const requestOrigin = resolveRequestOrigin(request);
    if (env.NODE_ENV !== 'development' && !isLoopbackHost(requestUrl.hostname)) {
        return new NextResponse('Not Found', { status: 404 });
    }

    const cookieStore = await cookies();
    let response = NextResponse.redirect(new URL(redirectPath, requestOrigin));
    const supabase = createServerClient(
        env.NEXT_PUBLIC_SUPABASE_URL,
        env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
        {
            cookies: {
                getAll() {
                    return cookieStore.getAll();
                },
                setAll(cookiesToSet) {
                    response = NextResponse.redirect(new URL(redirectPath, requestOrigin));
                    cookiesToSet.forEach(({ name, value, options }) => {
                        cookieStore.set(name, value, options);
                        response.cookies.set(name, value, options);
                    });
                },
            },
        },
    );

    const {
        data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
        const { error } = await supabase.auth.signInWithPassword({
            email: SEED_USER.EMAIL,
            password: SEED_USER.PASSWORD,
        });

        if (error) {
            return NextResponse.json({ error: error.message }, { status: 500 });
        }
    }

    return response;
}
