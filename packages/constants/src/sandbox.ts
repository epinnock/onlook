/**
 * Provider-agnostic sandbox template configuration.
 * Maps template names to provider-specific IDs and settings.
 */
export const SANDBOX_TEMPLATES = {
    expo: {
        name: 'Expo / React Native',
        cfImage: 'scry-expo:latest',
        csbTemplateId: 'zx8g3k',
        defaultPort: 8080,
    },
    nextjs: {
        name: 'Next.js',
        cfImage: 'scry-nextjs:latest',
        csbTemplateId: 'pt_EphPmsurimGCQdiB44wa7s',
        defaultPort: 3000,
    },
} as const;

export type SandboxTemplate = keyof typeof SANDBOX_TEMPLATES;

/** Provider identifiers matching the CodeProvider enum values */
export type SandboxProvider = 'cloudflare' | 'code_sandbox' | 'node_fs';

/** Dev server task name (same across providers) */
export const SANDBOX_DEV_TASK_NAME = 'dev';

/** Domain constants per provider */
export const PROVIDER_DOMAINS = {
    cloudflare: 'containers.dev',
    code_sandbox: 'csb.app',
} as const;

/**
 * Generate a preview URL for any supported provider.
 */
export function getSandboxPreviewUrl(
    provider: SandboxProvider,
    sandboxId: string,
    port: number,
): string {
    switch (provider) {
        case 'cloudflare':
            // CF sandbox preview URL format (will be refined when SDK is integrated)
            return `https://${sandboxId}-${port}.${PROVIDER_DOMAINS.cloudflare}`;
        case 'code_sandbox':
            return `https://${sandboxId}-${port}.${PROVIDER_DOMAINS.code_sandbox}`;
        case 'node_fs':
            return `http://localhost:${port}`;
        default:
            throw new Error(`Unknown provider: ${provider}`);
    }
}
