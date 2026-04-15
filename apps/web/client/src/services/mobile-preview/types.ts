export interface MobilePreviewStatusResponse {
    runtimeHash: string | null;
    clients: number;
    manifestUrl: string | null;
    runtimeSdkVersion: string | null;
}

export interface MobilePreviewRuntimeMessage {
    type: string;
    error?: string;
}
