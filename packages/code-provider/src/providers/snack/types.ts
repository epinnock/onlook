export interface SnackProviderOptions {
    name?: string;
    description?: string;
    sdkVersion?: string;
    initialFiles?: Record<string, { type: 'CODE'; contents: string }>;
    dependencies?: Record<string, { version: string }>;
    snackId?: string;
}

export interface SnackSessionInfo {
    snackId: string;
    url: string;
    webPreviewUrl: string;
    online: boolean;
}
