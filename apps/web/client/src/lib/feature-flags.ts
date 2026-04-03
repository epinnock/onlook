import { env } from '@/env';

export type ProviderFlag = 'cloudflare' | 'codesandbox';

const DEFAULT_PROVIDERS: ProviderFlag[] = ['codesandbox'];

/**
 * Check if a given sandbox provider is enabled via NEXT_PUBLIC_ENABLED_PROVIDERS.
 * Env var is comma-separated, e.g. "cloudflare,codesandbox".
 * Defaults to ['codesandbox'] if unset.
 */
export function isProviderEnabled(provider: ProviderFlag): boolean {
    const raw = env.NEXT_PUBLIC_ENABLED_PROVIDERS;
    if (!raw) return DEFAULT_PROVIDERS.includes(provider);
    const enabled = raw.split(',').map(s => s.trim()) as ProviderFlag[];
    return enabled.includes(provider);
}

/**
 * Get all currently enabled providers.
 */
export function getEnabledProviders(): ProviderFlag[] {
    const raw = env.NEXT_PUBLIC_ENABLED_PROVIDERS;
    if (!raw) return [...DEFAULT_PROVIDERS];
    return raw.split(',').map(s => s.trim()) as ProviderFlag[];
}
