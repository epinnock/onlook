/**
 * BrowserTask — virtual ProviderTask for ExpoBrowser branches.
 *
 * Wave A (TA.6). Replaces the inert stub in expo-browser/index.ts that
 * SessionManager.createTerminalSessions binds the bottom-panel "Task" tab
 * to. The task represents the dev server lifecycle for the in-browser
 * bundler — `restart()` triggers a re-bundle, `onOutput` streams progress
 * events from the bundler.
 *
 * The actual bundler (browser-metro) is a Wave C package that doesn't
 * exist on this branch yet. For Sprint 0 / Wave A, BrowserTask accepts
 * a `bundlerControl` callback the integrating layer (Wave H §1.3) supplies
 * once the bundler is wired. Until then it just emits a placeholder banner.
 */
import { ProviderTask, type ProviderTerminalShellSize } from '../../../types';

/**
 * Hooks supplied by the host environment (browser-metro / preview SW).
 * All fields optional — when absent, BrowserTask still satisfies the
 * ProviderTask contract but acts as a no-op.
 */
export interface BrowserTaskHost {
    /** Called when the task starts or restarts. Should kick a fresh bundle. */
    onRebundle?: () => Promise<void> | void;
    /** Called when the task is asked to stop. Should cancel any running bundle. */
    onStop?: () => Promise<void> | void;
    /** Initial banner emitted on open(). Defaults to a generic message. */
    banner?: string;
}

const DEFAULT_BANNER = 'Browser preview ready — bundler running in Web Worker.\n';

export class BrowserTask extends ProviderTask {
    private readonly _id: string;
    private readonly host: BrowserTaskHost;
    private listeners = new Set<(data: string) => void>();
    private opened = false;

    constructor(id: 'dev' | 'start', host: BrowserTaskHost = {}) {
        super();
        this._id = id;
        this.host = host;
    }

    get id(): string {
        return this._id;
    }

    get name(): string {
        return this._id === 'dev' ? 'browser-metro dev' : 'browser-metro start';
    }

    get command(): string {
        return 'browser-metro bundle';
    }

    /**
     * Returns the banner the bottom-panel xterm displays. Should be called
     * once per session. Subsequent calls re-emit the banner without
     * resubscribing listeners.
     */
    async open(_dimensions?: ProviderTerminalShellSize): Promise<string> {
        const banner = this.host.banner ?? DEFAULT_BANNER;
        this.opened = true;
        // Replay banner to existing listeners on re-open.
        this.emit(banner);
        return banner;
    }

    /** Trigger an initial bundle. Same path as restart() for the browser bundler. */
    async run(): Promise<void> {
        await this.runOrRestart('starting');
    }

    /** Trigger a fresh bundle. Called by SessionManager.restartDevServer. */
    async restart(): Promise<void> {
        await this.runOrRestart('restarting');
    }

    /** Cancel any in-flight bundle and stop emitting events. */
    async stop(): Promise<void> {
        if (this.host.onStop) {
            try {
                await this.host.onStop();
                this.emit('[browser-metro] stopped\n');
            } catch (err) {
                this.emit(`[browser-metro] stop failed: ${formatError(err)}\n`);
            }
        }
    }

    /**
     * Subscribe to bundler progress + error events. Returns an unsubscribe
     * function in the same shape as the existing terminal/task adapters.
     */
    onOutput(callback: (data: string) => void): () => void {
        this.listeners.add(callback);
        return () => {
            this.listeners.delete(callback);
        };
    }

    private async runOrRestart(verb: 'starting' | 'restarting'): Promise<void> {
        if (!this.opened) {
            // open() has not been called — emit the banner first so listeners
            // attached after this point still get a coherent transcript.
            await this.open();
        }
        this.emit(`[browser-metro] ${verb} bundle...\n`);

        if (!this.host.onRebundle) {
            this.emit('[browser-metro] no bundler attached yet (Wave H §1.3 wires this).\n');
            return;
        }

        try {
            await this.host.onRebundle();
            this.emit('[browser-metro] bundle ready\n');
        } catch (err) {
            this.emit(`[browser-metro] bundle failed: ${formatError(err)}\n`);
        }
    }

    private emit(line: string): void {
        for (const cb of this.listeners) {
            try {
                cb(line);
            } catch {
                // Ignore listener errors so one bad subscriber can't kill the rest.
            }
        }
    }
}

function formatError(err: unknown): string {
    if (err instanceof Error) return err.message;
    return String(err);
}
