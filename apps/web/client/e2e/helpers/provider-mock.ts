export interface MockProviderConfig {
    provider: 'cloudflare' | 'codesandbox';
    shouldFail?: boolean;
    latencyMs?: number;
}

export function createMockProviderResponse(config: MockProviderConfig) {
    if (config.shouldFail) {
        return { success: false, error: 'Mock provider failure' };
    }

    return {
        success: true,
        sandboxId: `${config.provider}-mock-${Date.now()}`,
        previewUrl:
            config.provider === 'cloudflare'
                ? 'https://mock.containers.cloudflare.com'
                : 'https://mock-sandbox-8080.csb.app',
    };
}
