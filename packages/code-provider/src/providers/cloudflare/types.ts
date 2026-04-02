export interface CloudflareProviderOptions {
    sandboxId?: string;
    apiToken?: string;
    accountId?: string;
    image?: string;
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
