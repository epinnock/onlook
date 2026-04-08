/**
 * BrowserMetro — main-thread host for the in-browser bundler.
 *
 * Wave R2 (TR2.5) composes the four sub-modules that were extracted from the
 * original monolithic host:
 *
 *   - file-walker (TR2.1)         — recursive Vfs walk → normalized file list
 *   - entry-resolver (TR2.2)      — picks the bundle entry from candidates
 *   - bare-import-rewriter (TR2.3) — rewrites bare imports to ESM CDN URLs
 *   - iife-wrapper (TR2.4)        — wraps the module map in a self-contained IIFE
 *
 * The pipeline now yields, in addition to the legacy flat module map, a
 * self-contained `iife` string + `importmap` JSON + deduped `bareImports`
 * list that the preview iframe and service worker consume directly.
 */

import { transform } from 'sucrase';
import { rewriteBareImports } from './bare-import-rewriter';
import { walkVfs } from './file-walker';
import { resolveEntry } from './entry-resolver';
import { wrapAsIIFE, type IIFEModule } from './iife-wrapper';
import {
    BundleError,
    type BrowserMetroOptions,
    type BundleModule,
    type BundleResult,
    type Vfs,
} from './types';

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
     * Walk the Vfs, rewrite bare imports, transpile each file, resolve the
     * entry, and wrap everything in a self-contained IIFE.
     * Throws BundleError on transpile failure.
     */
    async bundle(): Promise<BundleResult> {
        const start = performance.now();
        try {
            // 1. Walk the Vfs.
            const walked = await walkVfs(this.vfs);

            // 2. Resolve the entry from the walked paths.
            const entry = resolveEntry({ paths: walked.map((f) => f.path) });

            // 3 + 4. Rewrite bare imports, transpile, collect deduped bares + URLs.
            const modules: Record<string, BundleModule> = {};
            const iifeModules: IIFEModule[] = [];
            const allBares = new Set<string>();
            const allBareUrls = new Set<string>();

            for (const file of walked) {
                try {
                    const rewritten = rewriteBareImports(file.content, {
                        esmUrl: this.esmUrl,
                    });
                    for (const spec of rewritten.bareImports) {
                        allBares.add(spec);
                    }
                    for (const url of rewritten.bareImportUrls) {
                        allBareUrls.add(url);
                    }
                    const transformed = transform(rewritten.code, {
                        transforms: ['jsx', 'typescript', 'imports'],
                        production: false,
                        jsxRuntime: 'automatic',
                        filePath: file.path,
                    });
                    modules[file.path] = {
                        path: file.path,
                        code: transformed.code,
                        deps: rewritten.bareImports,
                    };
                    iifeModules.push({ path: file.path, code: transformed.code });
                } catch (err) {
                    throw new BundleError(
                        `Transpile failed for ${file.path}: ${err instanceof Error ? err.message : String(err)}`,
                        file.path,
                        err,
                    );
                }
            }

            // 5. Wrap the module map in a self-contained IIFE.
            // Pass bare names + URL forms separately so the wrapper builds
            // the importmap from names and the pre-fetch list from URLs.
            const bareImports = Array.from(allBares);
            const bareImportUrls = Array.from(allBareUrls);
            const wrap = wrapAsIIFE({
                entry,
                modules: iifeModules,
                bareImports,
                bareImportUrls,
                esmUrl: this.esmUrl,
            });

            // 6. Return the bundle with legacy fields + the new iife/importmap/bareImports.
            const result: BundleResult = {
                modules,
                entry,
                durationMs: performance.now() - start,
                iife: wrap.code,
                importmap: wrap.importmap,
                bareImports,
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
