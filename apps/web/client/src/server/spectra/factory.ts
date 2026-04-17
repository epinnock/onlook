import 'server-only';

import { env } from '@/env';

import { SpectraClient, SpectraConfigError } from './client';

/**
 * Server-only factory that wires a `SpectraClient` up against the
 * validated env. Tests instantiate `SpectraClient` directly with an
 * explicit baseUrl (and a mocked fetch) — they don't need `@/env` to
 * parse, which is why the env-reading bit lives here instead of the
 * class constructor.
 */
export function createSpectraClient(): SpectraClient {
    if (!env.SPECTRA_API_URL) {
        throw new SpectraConfigError(
            'SPECTRA_API_URL is not set — Spectra preview cannot be used without a configured API.',
        );
    }
    return new SpectraClient({
        baseUrl: env.SPECTRA_API_URL,
        token: env.SPECTRA_API_TOKEN,
    });
}
