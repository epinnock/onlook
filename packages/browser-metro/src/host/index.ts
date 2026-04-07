/**
 * BrowserMetro — main-thread host for the in-browser bundler.
 *
 * Wave C scaffold. The full Metro-compatible bundler (with proper
 * dependency graph traversal, .web.js extension resolution, React
 * Refresh boundaries, and chunked output) is vendored from
 * github.com/RapidNative/reactnative-run in a follow-up sprint. For
 * Sprint 0 / Wave A we ship a minimal working pipeline:
 *
 *   - Walks the supplied Vfs for .ts/.tsx/.js/.jsx files
 *   - Transpiles each with Sucrase (jsx, ts, imports)
 *   - Returns a flat module map
 *   - Broadcasts the result on a BroadcastChannel
 *
 * The preview iframe (Wave H §1.3) is responsible for stitching the
 * modules together via an import map and a small runtime loader.
 */

import { transform } from 'sucrase';
import {
    BundleError,
    type BrowserMetroOptions,
    type BundleModule,
    type BundleResult,
    type Vfs,
} from './types';

const SUPPORTED_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const ENTRY_CANDIDATES = [
    'App.tsx',
    'App.jsx',
    'App.js',
    'src/App.tsx',
    'src/App.jsx',
    'index.tsx',
    'index.js',
];
const BARE_IMPORT_RE = /(?:^|\n)\s*(?:import\s+(?:[^'"]+from\s+)?|export\s+(?:[^'"]+from\s+))['"]([^'"./][^'"]*)['"]/g;

export class BrowserMetro {
    private readonly vfs: Vfs;
    private readonly esmUrl: string;
    private readonly broadcastChannelName: string;
    private readonly logger: BrowserMetroOptions['logger'];
    private channel: BroadcastChannel | null = null;
    private latestBundle: BundleResult | null = null;
    private updateListeners = new Set<(result: BundleResult) => void>();

    constructor(options: BrowserMetroOptions) {
        this.vfs = options.vfs;
        this.esmUrl = options.esmUrl;
        this.broadcastChannelName = options.broadcastChannel ?? 'onlook-preview';
        this.logger = options.logger ?? {
            debug: (m) => console.debug('[browser-metro]', m),
            info: (m) => console.info('[browser-metro]', m),
            error: (m, e) => console.error('[browser-metro]', m, e),
        };

        if (typeof BroadcastChannel !== 'undefined') {
            try {
                this.channel = new BroadcastChannel(this.broadcastChannelName);
            } catch (err) {
                this.logger?.error('Failed to open BroadcastChannel', err);
                this.channel = null;
            }
        }
    }

    /** Get the latest bundle without re-running the pipeline. */
    getLatest(): BundleResult | null {
        return this.latestBundle;
    }

    /** Subscribe to bundle updates. Returns an unsubscribe function. */
    onUpdate(cb: (result: BundleResult) => void): () => void {
        this.updateListeners.add(cb);
        return () => {
            this.updateListeners.delete(cb);
        };
    }

    /**
     * Walk the Vfs, transpile every supported file, return the bundle.
     * Throws BundleError on transpile failure.
     */
    async bundle(): Promise<BundleResult> {
        const start = performance.now();
        try {
            const entries = await this.vfs.listAll();
            const fileEntries = entries
                .filter((e) => e.type === 'file' && this.isSourceFile(e.path))
                .map((e) => normalizeRelative(e.path));

            const modules: Record<string, BundleModule> = {};
            for (const path of fileEntries) {
                try {
                    const raw = await this.vfs.readFile(path);
                    const source = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
                    const result = transform(source, {
                        transforms: ['jsx', 'typescript', 'imports'],
                        production: false,
                        jsxRuntime: 'automatic',
                        filePath: path,
                    });
                    modules[path] = {
                        path,
                        code: result.code,
                        deps: extractBareImports(source),
                    };
                } catch (err) {
                    throw new BundleError(
                        `Transpile failed for ${path}: ${err instanceof Error ? err.message : String(err)}`,
                        path,
                        err,
                    );
                }
            }

            const entry =
                ENTRY_CANDIDATES.find((candidate) => modules[candidate]) ??
                Object.keys(modules)[0] ??
                'App.tsx';

            const result: BundleResult = {
                modules,
                entry,
                durationMs: performance.now() - start,
            };

            this.latestBundle = result;
            this.publish(result);
            this.logger?.info(
                `bundled ${Object.keys(modules).length} modules in ${result.durationMs.toFixed(0)}ms (entry: ${entry})`,
            );
            return result;
        } catch (err) {
            if (err instanceof BundleError) throw err;
            throw new BundleError(
                `Bundle failed: ${err instanceof Error ? err.message : String(err)}`,
                undefined,
                err,
            );
        }
    }

    /**
     * Re-run the bundle. Used by BrowserTask.restart() and the
     * file-watcher debounce in the Wave H integration.
     */
    async invalidate(): Promise<void> {
        await this.bundle();
    }

    /** Tear down the BroadcastChannel and clear listeners. */
    dispose(): void {
        this.channel?.close();
        this.channel = null;
        this.updateListeners.clear();
        this.latestBundle = null;
    }

    /** Get the configured ESM CDN URL — used by the preview iframe import map. */
    getEsmUrl(): string {
        return this.esmUrl;
    }

    private isSourceFile(filePath: string): boolean {
        const lower = filePath.toLowerCase();
        return SUPPORTED_EXTENSIONS.some((ext) => lower.endsWith(ext));
    }

    private publish(result: BundleResult): void {
        for (const cb of this.updateListeners) {
            try {
                cb(result);
            } catch (err) {
                this.logger?.error('update listener failed', err);
            }
        }
        if (this.channel) {
            try {
                this.channel.postMessage({ type: 'bundle', result });
            } catch (err) {
                this.logger?.error('BroadcastChannel post failed', err);
            }
        }
    }
}

function normalizeRelative(filePath: string): string {
    return filePath.startsWith('/') ? filePath.slice(1) : filePath;
}

function extractBareImports(source: string): string[] {
    const out = new Set<string>();
    let m: RegExpExecArray | null;
    BARE_IMPORT_RE.lastIndex = 0;
    while ((m = BARE_IMPORT_RE.exec(source)) !== null) {
        const spec = m[1];
        if (spec && !spec.startsWith('.') && !spec.startsWith('/')) {
            out.add(spec);
        }
    }
    return Array.from(out);
}
