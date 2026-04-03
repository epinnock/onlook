import {
    ProviderFileWatcher,
    type WatchEvent,
    type WatchFilesInput,
} from '../../../types';

/**
 * Represents the subset of a Cloudflare sandbox API needed for file watching.
 * The real SDK type will be substituted once the Cloudflare Workers SDK is integrated.
 */
export interface CloudflareSandboxWatchAPI {
    files: {
        watch(
            path: string,
            options: { recursive?: boolean; excludes?: string[] },
            callback: (event: WatchEvent) => void,
        ): { unsubscribe: () => void };
    };
}

export class CloudflareFileWatcher extends ProviderFileWatcher {
    private unsubscribe: (() => void) | null = null;
    private callbacks: Array<(event: WatchEvent) => Promise<void>> = [];

    constructor(
        private readonly sandbox: CloudflareSandboxWatchAPI,
    ) {
        super();
    }

    async start(input: WatchFilesInput): Promise<void> {
        const watcher = this.sandbox.files.watch(
            input.args.path,
            {
                recursive: input.args.recursive,
                excludes: input.args.excludes || [],
            },
            (event: WatchEvent) => {
                for (const cb of this.callbacks) {
                    cb(event);
                }
            },
        );
        this.unsubscribe = watcher.unsubscribe;
    }

    async stop(): Promise<void> {
        this.unsubscribe?.();
        this.unsubscribe = null;
    }

    registerEventCallback(callback: (event: WatchEvent) => Promise<void>): void {
        this.callbacks.push(callback);
    }
}
