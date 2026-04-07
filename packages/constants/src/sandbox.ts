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
export type SandboxProvider = 'cloudflare' | 'code_sandbox' | 'node_fs' | 'expo_browser';

/** Dev server task name (same across providers) */
export const SANDBOX_DEV_TASK_NAME = 'dev';

/** Domain constants per provider */
export const PROVIDER_DOMAINS = {
    cloudflare: 'containers.dev',
    code_sandbox: 'csb.app',
} as const;

/**
 * Generate a preview URL for any supported provider.
 *
 * For ExpoBrowser branches, returns a same-origin path that the in-app
 * service worker (Wave H §1.3, TH.1) intercepts to serve the browser-metro
 * bundled HTML/JS shell. The frame.url field stores this exact path so
 * <iframe src={frame.url}> works unchanged on multi-frame canvases.
 *
 * The sandboxId for ExpoBrowser branches is the branch UUID itself
 * (Position B does NOT mint synthetic sandbox identifiers — branches that
 * opt into ExpoBrowser keep their existing CSB sandboxId for fallback;
 * sandboxId here is just used as the URL key).
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
        case 'expo_browser':
            // Same-origin path; Wave H service worker serves the bundle.
            // Port is ignored — bundling happens client-side.
            return `/preview/${sandboxId}`;
        default:
            throw new Error(`Unknown provider: ${provider satisfies never}`);
    }
}
