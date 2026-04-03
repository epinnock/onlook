import type { WatchEvent, WatchFilesInput } from '../../../types';
import { ProviderFileWatcher } from '../../../types';

interface SnackStateListener {
    remove(): void;
}

interface SnackLike {
    addStateListener(
        cb: (state: { files: Record<string, { contents: string }> }) => void,
    ): SnackStateListener;
    getState(): { files: Record<string, { contents: string }> };
}

export class SnackFileWatcher extends ProviderFileWatcher {
    private listener: SnackStateListener | null = null;
    private callbacks: Array<(event: WatchEvent) => Promise<void>> = [];
    private previousFiles: Map<string, string> = new Map();

    constructor(private snack: SnackLike) {
        super();
    }

    async start(_input: WatchFilesInput): Promise<void> {
        const initialFiles = this.snack.getState().files;
        this.previousFiles = new Map();
        for (const [path, file] of Object.entries(initialFiles)) {
            this.previousFiles.set(path, file.contents);
        }

        this.listener = this.snack.addStateListener((state) => {
            const currentFiles = state.files;
            const currentPaths = new Set(Object.keys(currentFiles));
            const previousPaths = new Set(this.previousFiles.keys());

            const added: string[] = [];
            const removed: string[] = [];
            const changed: string[] = [];

            for (const path of currentPaths) {
                if (!previousPaths.has(path)) {
                    added.push(path);
                } else if (currentFiles[path].contents !== this.previousFiles.get(path)) {
                    changed.push(path);
                }
            }

            for (const path of previousPaths) {
                if (!currentPaths.has(path)) {
                    removed.push(path);
                }
            }

            // Update snapshot before firing callbacks
            this.previousFiles = new Map();
            for (const [path, file] of Object.entries(currentFiles)) {
                this.previousFiles.set(path, file.contents);
            }

            // Fire callbacks for each event type that has paths
            const events: WatchEvent[] = [];
            if (added.length > 0) {
                events.push({ type: 'add', paths: added });
            }
            if (removed.length > 0) {
                events.push({ type: 'remove', paths: removed });
            }
            if (changed.length > 0) {
                events.push({ type: 'change', paths: changed });
            }

            for (const event of events) {
                for (const cb of this.callbacks) {
                    cb(event);
                }
            }
        });
    }

    async stop(): Promise<void> {
        this.listener?.remove();
        this.listener = null;
    }

    registerEventCallback(callback: (event: WatchEvent) => Promise<void>): void {
        this.callbacks.push(callback);
    }
}
