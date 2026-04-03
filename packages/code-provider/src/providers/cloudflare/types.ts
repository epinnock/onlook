export interface CloudflareProviderOptions {
    sandboxId?: string;
    apiToken?: string;
    accountId?: string;
    image?: string;
    /** URL of the Cloudflare Sandbox Worker (e.g. http://localhost:8787) */
    workerUrl?: string;
}

export interface CloudflareSandboxConfig {
    image: string;
    port: number;
    template: 'expo' | 'nextjs';
}

export interface CloudflareSessionInfo {
    sandboxId: string;
    previewUrl: string;
    status: 'running' | 'paused' | 'stopped' | 'creating';
}
