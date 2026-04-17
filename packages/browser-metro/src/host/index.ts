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

interface LocalImportShim {
    specifier: string;
    remoteSpecifiers?: readonly string[];
    path: string;
    code: string | ((baseUrlNoSlash: string) => string);
    remoteDependencies?: (baseUrlNoSlash: string) => readonly string[];
}

const LOCAL_IMPORT_SHIMS: readonly LocalImportShim[] = [
    {
        specifier: 'react-native',
        remoteSpecifiers: ['react-native', 'react-native-web'],
        path: '__browser_metro_shims__/react-native.js',
        remoteDependencies: (baseUrlNoSlash) => [
            `${baseUrlNoSlash}/react?bundle`,
            `${baseUrlNoSlash}/react-native-web?bundle`,
        ],
        code: (baseUrlNoSlash) => {
            const reactUrl = `${baseUrlNoSlash}/react?bundle`;
            const reactNativeWebUrl = `${baseUrlNoSlash}/react-native-web?bundle`;

            return `const ReactModule = require(${JSON.stringify(reactUrl)});
const React = ReactModule && ReactModule.default ? ReactModule.default : ReactModule;
const ReactNativeWebModule = require(${JSON.stringify(reactNativeWebUrl)});
const ReactNativeWeb = ReactNativeWebModule && ReactNativeWebModule.default && ReactNativeWebModule.default.View
  ? ReactNativeWebModule.default
  : ReactNativeWebModule;

function flattenStyle(style) {
  if (Array.isArray(style)) {
    return style.reduce((acc, item) => Object.assign(acc, flattenStyle(item)), {});
  }

  if (style && typeof style === 'object') {
    return style;
  }

  return {};
}

const Switch = React.forwardRef(function OnlookBrowserMetroSwitch(props, ref) {
  const {
    accessibilityLabel,
    activeThumbColor,
    activeTrackColor,
    disabled,
    ios_backgroundColor,
    nativeID,
    onChange,
    onValueChange,
    style,
    testID,
    thumbColor,
    trackColor,
    value,
    ...rest
  } = props || {};
  const checked = value === true;
  const height = 20;
  const width = 40;
  const trackColorValue = checked
    ? (trackColor && typeof trackColor === 'object' ? trackColor.true : activeTrackColor) || '#22c55e'
    : (trackColor && typeof trackColor === 'object' ? trackColor.false : trackColor) || ios_backgroundColor || '#475569';
  const thumbColorValue = checked
    ? activeThumbColor || thumbColor || '#f8fafc'
    : thumbColor || '#cbd5e1';

  function handleChange(event) {
    const nextValue = Boolean(event && event.target && event.target.checked);
    if (typeof onChange === 'function') {
      onChange(event);
    }
    if (typeof onValueChange === 'function') {
      onValueChange(nextValue);
    }
  }

  return React.createElement('label', {
    ...rest,
    'aria-disabled': disabled ? 'true' : undefined,
    'data-testid': testID,
    id: nativeID,
    style: {
      ...flattenStyle(style),
      cursor: disabled ? 'default' : 'pointer',
      display: 'inline-block',
      height,
      position: 'relative',
      userSelect: 'none',
      width,
    },
  },
    React.createElement('span', {
      style: {
        backgroundColor: trackColorValue,
        borderRadius: height / 2,
        display: 'block',
        height: Math.round(height * 0.7),
        left: 0,
        position: 'absolute',
        right: 0,
        top: Math.round(height * 0.15),
        transition: 'background-color 100ms ease',
      },
    }),
    React.createElement('span', {
      style: {
        backgroundColor: thumbColorValue,
        borderRadius: '50%',
        boxShadow: '0 1px 3px rgba(15, 23, 42, 0.35)',
        display: 'block',
        height,
        left: checked ? width - height : 0,
        position: 'absolute',
        top: 0,
        transition: 'left 100ms ease, background-color 100ms ease',
        width: height,
      },
    }),
    React.createElement('input', {
      'aria-label': accessibilityLabel,
      checked,
      disabled,
      onChange: handleChange,
      ref,
      role: 'switch',
      style: {
        appearance: 'none',
        background: 'transparent',
        border: 0,
        cursor: disabled ? 'default' : 'pointer',
        height: '100%',
        inset: 0,
        margin: 0,
        padding: 0,
        position: 'absolute',
        width: '100%',
      },
      type: 'checkbox',
    }),
  );
});

for (const key in ReactNativeWeb) {
  exports[key] = ReactNativeWeb[key];
}

exports.Switch = Switch;
exports.default = { ...ReactNativeWeb, Switch };
exports.__esModule = true;`;
        },
    },
    {
        specifier: 'expo-status-bar',
        path: '__browser_metro_shims__/expo-status-bar.js',
        code: `function StatusBar() { return null; }
exports.StatusBar = StatusBar;
exports.default = StatusBar;
exports.__esModule = true;`,
    },
];

function getLocalShimUrl(baseUrlNoSlash: string, specifier: string): string {
    return `${baseUrlNoSlash}/${specifier}?bundle`;
}

function getLocalShimUrls(
    shim: LocalImportShim,
    baseUrlNoSlash: string,
): string[] {
    const specifiers = shim.remoteSpecifiers ?? [shim.specifier];
    return specifiers.map((specifier) => getLocalShimUrl(baseUrlNoSlash, specifier));
}

function getLocalShimForUrl(
    url: string,
    baseUrlNoSlash: string,
): LocalImportShim | null {
    return (
        LOCAL_IMPORT_SHIMS.find((shim) =>
            getLocalShimUrls(shim, baseUrlNoSlash).includes(url),
        ) ?? null
    );
}

function resolveLocalShimCode(
    shim: LocalImportShim,
    baseUrlNoSlash: string,
): string {
    if (typeof shim.code === 'function') {
        return shim.code(baseUrlNoSlash);
    }

    return shim.code;
}

function collectLocalShimRemoteDependencies(
    shim: LocalImportShim,
    baseUrlNoSlash: string,
): readonly string[] {
    return shim.remoteDependencies?.(baseUrlNoSlash) ?? [];
}

function applyLocalImportShims(
    code: string,
    baseUrlNoSlash: string,
    usedLocalShims: Set<string>,
): string {
    let nextCode = code;

    for (const shim of LOCAL_IMPORT_SHIMS) {
        for (const remoteUrl of getLocalShimUrls(shim, baseUrlNoSlash)) {
            if (!nextCode.includes(remoteUrl)) {
                continue;
            }

            usedLocalShims.add(shim.specifier);
            nextCode = nextCode.split(remoteUrl).join(`/${shim.path}`);
        }
    }

    return nextCode;
}

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
            const usedLocalShims = new Set<string>();
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
                    const localShim = getLocalShimForUrl(url, baseUrlNoSlash);
                    allBares.add(spec);

                    if (localShim) {
                        usedLocalShims.add(localShim.specifier);
                        return `require(${quote}/${localShim.path}${quote})`;
                    }

                    allBareUrls.add(url);
                    return `require(${quote}${url}${quote})`;
                });
            };

            for (const file of walked) {
                try {
                    const rewritten = rewriteBareImports(file.content, {
                        esmUrl: this.esmUrl,
                    });
                    for (const spec of rewritten.bareImports) {
                        allBares.add(spec);
                    }
                    for (const url of rewritten.bareImportUrls) {
                        const localShim = getLocalShimForUrl(url, baseUrlNoSlash);
                        if (localShim) {
                            usedLocalShims.add(localShim.specifier);
                            continue;
                        }

                        allBareUrls.add(url);
                    }
                    const sourceWithLocalShims = applyLocalImportShims(
                        rewritten.code,
                        baseUrlNoSlash,
                        usedLocalShims,
                    );
                    const transformed = transform(sourceWithLocalShims, {
                        transforms: ['jsx', 'typescript', 'imports'],
                        production: false,
                        jsxRuntime: 'automatic',
                        filePath: file.path,
                    });
                    // Post-sucrase rewrite: catch any require('bare-name')
                    // that the JSX runtime auto-injection added.
                    const finalCode = applyLocalImportShims(
                        rewritePostSucraseRequires(transformed.code),
                        baseUrlNoSlash,
                        usedLocalShims,
                    );
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

            for (const shim of LOCAL_IMPORT_SHIMS) {
                if (!usedLocalShims.has(shim.specifier)) {
                    continue;
                }

                for (const url of collectLocalShimRemoteDependencies(
                    shim,
                    baseUrlNoSlash,
                )) {
                    allBareUrls.add(url);
                }

                const shimCode = resolveLocalShimCode(shim, baseUrlNoSlash);
                modules[shim.path] = {
                    path: shim.path,
                    code: shimCode,
                    deps: [],
                };
                iifeModules.push({
                    path: shim.path,
                    code: shimCode,
                });
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
