/**
 * Per-user feature flag map. Persisted in users.feature_flags as a jsonb
 * column. Read by useUserFeatureFlags to gate the per-branch ExpoBrowser
 * preview runtime toggle and other dogfood-only features.
 *
 * Mirror of UserFeatureFlags in @onlook/db/schema/user/user.ts. Kept here
 * to avoid a cross-package dependency from @onlook/models on @onlook/db.
 */
export interface UserFeatureFlags {
    /**
     * When true, the per-branch ExpoBrowser preview runtime toggle is
     * visible in project settings. When false (or absent), every branch is
     * forced to code_sandbox regardless of the branches.provider_type column.
     */
    useExpoBrowserPreview?: boolean;
}

export interface User {
    id: string;
    firstName: string | null;
    lastName: string | null;
    displayName: string | null;
    avatarUrl: string | null;
    email: string | null;
    createdAt: Date;
    updatedAt: Date;
    stripeCustomerId: string | null;
    githubInstallationId: string | null;
    featureFlags: UserFeatureFlags;
}
