export interface MobilePreviewVfs {
    listAll(): Promise<Array<{ path: string; type: 'file' | 'directory' }>>;
    readFile(path: string): Promise<string | Uint8Array>;
    watchDirectory(
        path: string,
        callback: (event: {
            type: 'create' | 'update' | 'delete' | 'rename';
            path: string;
        }) => void,
    ): () => void;
}

export interface MobilePreviewBundleResult {
    code: string;
    entryPath: string;
    moduleCount: number;
}

export class MobilePreviewBundleError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'MobilePreviewBundleError';
    }
}
