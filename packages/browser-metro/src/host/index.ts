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
import { checkReactVersions } from './react-version-guard';
import { transformWithJsxSource } from './sucrase-jsx-source';
import {
    BundleError,
    type BrowserMetroOptions,
    type BundleOptions,
    type BundleTarget,
    type BundleModule,
    type BundleResult,
    type Vfs,
} from './types';

export class BrowserMetro {
    private readonly vfs: Vfs;
    private readonly esmUrl: string;
    private readonly broadcastChannelName: string;
    private readonly target: BundleTarget;
    private readonly isDev: boolean;
    private readonly logger: BrowserMetroOptions['logger'];
    private channel: BroadcastChannel | null = null;
    private latestBundle: BundleResult | null = null;
    private updateListeners = new Set<(result: BundleResult) => void>();

    constructor(options: BrowserMetroOptions) {
        this.vfs = options.vfs;
        this.esmUrl = options.esmUrl;
        this.target = options.target ?? 'expo-go';
        this.isDev = options.isDev !== false;
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
     *
     * When `options.projectDependencies` is provided, the bundler first runs
     * the MC6.4 React version guard and throws a `BundleError` on mismatch
     * before any transpile work. Omitting the option preserves back-compat
     * for callers without access to the project's `package.json`.
     */
    async bundle(options: BundleOptions = {}): Promise<BundleResult> {
        const start = performance.now();
        try {
            // 0. MC6.4: bundle-time React version guard. Only runs when the
            // caller supplies the project's dependency map; otherwise we skip
            // silently for back-compat with existing callers (e.g. the TR4.1
            // file-watcher loop and the legacy host tests).
            if (options.projectDependencies) {
                const guard = checkReactVersions({
                    react: options.projectDependencies.react,
                    'react-reconciler': options.projectDependencies['react-reconciler'],
                });
                if (!guard.ok) {
                    throw new BundleError(
                        `React version guard failed:\n  - ${guard.errors.join('\n  - ')}`,
                    );
                }
            }

            // 1. Walk the Vfs.
            const walked = await walkVfs(this.vfs);

            // 2. Resolve the entry from the walked paths.
            const entry = resolveEntry({ paths: walked.map((f) => f.path) });

            // 3 + 4. Rewrite bare imports, transpile, collect deduped bares + URLs.
            const modules: Record<string, BundleModule> = {};
            const iifeModules: IIFEModule[] = [];
            const allBares = new Set<string>();
            const allBareUrls = new Set<string>();

            // FOUND-06b follow-up #4 (2026-04-08): post-sucrase pass to catch
            // bare require() calls that sucrase emits AFTER our pre-sucrase
            // rewriter ran. The biggest offender is the automatic JSX runtime:
            // sucrase's `jsxRuntime: 'automatic'` injects
            // `require('react/jsx-dev-runtime')` directly into the transformed
            // output without going through an `import` statement we could
            // intercept upstream. The only safe place to catch it is on the
            // transformed code, just before it goes into the IIFE wrapper.
            const POST_REQUIRE_RE =
                /require\((['"])([^./'"][^'"]*)\1\)/g;
            const baseUrlNoSlash = this.esmUrl.endsWith('/')
                ? this.esmUrl.slice(0, -1)
                : this.esmUrl;
            const rewritePostSucraseRequires = (code: string): string => {
                return code.replace(POST_REQUIRE_RE, (match, quote: string, spec: string) => {
                    // Skip if already a URL
                    if (spec.startsWith('http://') || spec.startsWith('https://')) {
                        return match;
                    }
                    // Skip if relative (regex already excludes leading . and /,
                    // but defensively re-check)
                    if (spec.startsWith('.') || spec.startsWith('/')) {
                        return match;
                    }
                    const url = `${baseUrlNoSlash}/${spec}?bundle`;
                    allBares.add(spec);
                    allBareUrls.add(url);
                    return `require(${quote}${url}${quote})`;
                });
            };

            // MC4.13: when targeting onlook-client in dev mode, use the
            // jsx-source transform (MC4.12) so every React.createElement
            // call carries __source metadata for the inspector. This swaps
            // the JSX runtime from automatic to classic and adds a second
            // Sucrase pass for the `imports` transform.
            const useJsxSource =
                this.target === 'onlook-client' && this.isDev;

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

                    let transpiled: string;
                    if (useJsxSource) {
                        // Step A: jsx + ts via classic runtime with __source
                        // injection (MC4.12).
                        const jsxResult = transformWithJsxSource(
                            rewritten.code,
                            file.path,
                            { isDev: true },
                        );
                        // Step B: CJS module transform (import/export →
                        // require/module.exports) so the IIFE wrapper's
                        // require() runtime can resolve modules.
                        const importsResult = transform(jsxResult.code, {
                            transforms: ['imports'],
                            filePath: file.path,
                        });
                        transpiled = importsResult.code;
                    } else {
                        const transformed = transform(rewritten.code, {
                            transforms: ['jsx', 'typescript', 'imports'],
                            production: false,
                            jsxRuntime: 'automatic',
                            filePath: file.path,
                        });
                        transpiled = transformed.code;
                    }

                    // Post-sucrase rewrite: catch any require('bare-name')
                    // that the JSX runtime auto-injection added.
                    const finalCode = rewritePostSucraseRequires(transpiled);
                    modules[file.path] = {
                        path: file.path,
                        code: finalCode,
                        deps: rewritten.bareImports,
                    };
                    iifeModules.push({ path: file.path, code: finalCode });
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
     *
     * Accepts the same `BundleOptions` as `bundle()` so callers can re-run
     * with a fresh `projectDependencies` snapshot (e.g. after the user edits
     * `package.json`).
     */
    async invalidate(options: BundleOptions = {}): Promise<void> {
        await this.bundle(options);
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
