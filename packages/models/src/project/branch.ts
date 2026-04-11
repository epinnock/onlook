/**
 * String literal corresponding to the CodeProvider enum in
 * @onlook/code-provider/providers.ts. Kept as a string here to avoid a
 * cross-package dependency on @onlook/code-provider from @onlook/models.
 *
 * Allowed values: 'code_sandbox' | 'cloudflare' | 'expo_browser' | 'node_fs'
 */
export type BranchProviderType = string;

export interface Branch {
    id: string;
    projectId: string;
    name: string;
    description: string | null;
    createdAt: Date;
    updatedAt: Date;
    isDefault: boolean;
    git: {
        branch: string | null;
        commitSha: string | null;
        repoUrl: string | null;
    } | null;
    sandbox: {
        id: string;
        /**
         * Which CodeProvider runs the editor session for this branch.
         * Persisted in the branches.provider_type column. Default
         * 'code_sandbox' for all existing rows.
         */
        providerType: BranchProviderType;
    };
}
