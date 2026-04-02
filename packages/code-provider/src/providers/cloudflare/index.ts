import type { CloudflareProviderOptions } from './types';
export type { CloudflareProviderOptions } from './types';
export type { CloudflareSandboxConfig, CloudflareSessionInfo } from './types';

// Stub — Phase 2 (T2.1) will implement all abstract methods
export class CloudflareSandboxProvider {
    constructor(public readonly options: CloudflareProviderOptions) {}
}
