export type MCPTransportType = 'sse' | 'http';

export type MCPAuthType = 'none' | 'api_key' | 'oauth';

export interface MCPOAuthTokens {
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
}

export interface MCPServerConfig {
    id: string;
    name: string;
    transport: MCPTransportType;
    url: string;
    authType?: MCPAuthType;
    apiKey?: string;
    oauth?: MCPOAuthTokens;
    enabled: boolean;
}
