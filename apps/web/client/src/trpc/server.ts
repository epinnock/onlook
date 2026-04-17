import 'server-only';

import { createHydrationHelpers } from '@trpc/react-query/rsc';
import { headers } from 'next/headers';
import { NextRequest } from 'next/server';
import { cache } from 'react';
import { createCaller, type AppRouter } from '~/server/api/root';
import { createTRPCContext } from '~/trpc/request-server';
import { createQueryClient } from './query-client';

/**
 * This wraps the `createTRPCContext` helper and provides the required context for the tRPC API when
 * handling a tRPC call from a React Server Component.
 */
const createContext = cache(async () => {
    const heads = new Headers(await headers());
    heads.set('x-trpc-source', 'rsc');

    const request = new NextRequest('http://127.0.0.1/__rsc_trpc__', {
        headers: heads,
    });

    return createTRPCContext(request, {
        headers: heads,
    });
});

const getQueryClient = cache(createQueryClient);
const caller = createCaller(createContext);

export const { trpc: api, HydrateClient } = createHydrationHelpers<AppRouter>(
    caller,
    getQueryClient,
);
