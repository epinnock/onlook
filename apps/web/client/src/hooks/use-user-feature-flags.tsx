'use client';

/**
 * Wave I §0.5 — DB-backed user feature flag hook.
 *
 * Distinct from the existing `useFeatureFlags` (which reads env vars at
 * build time and is global per deployment). This hook reads
 * users.featureFlags from the DB via tRPC and is per-account, not per-
 * deployment. Used to gate the per-branch ExpoBrowser preview runtime
 * toggle in project settings.
 *
 * After ExpoBrowser GA, this hook can be deleted and the toggle can be
 * unconditionally visible. Until then, the env-based flags stay for
 * deployment gating and this jsonb-backed flag is the dogfood gate.
 */
import { api } from '@/trpc/react';

export interface UserFeatureFlagsHookResult {
    /** True when the data is still loading or the user is not authenticated. */
    isLoading: boolean;
    /** Returns the boolean value of a flag, defaulting to false. */
    isEnabled: (key: 'useExpoBrowserPreview' | (string & {})) => boolean;
    /** Raw flag map. */
    flags: Record<string, boolean>;
}

export function useUserFeatureFlags(): UserFeatureFlagsHookResult {
    const query = api.user.getFeatureFlags.useQuery(undefined, {
        staleTime: 30_000,
    });

    const flags: Record<string, boolean> = (query.data ?? {}) as Record<string, boolean>;

    return {
        isLoading: query.isLoading,
        isEnabled: (key: string) => flags[key] === true,
        flags,
    };
}
