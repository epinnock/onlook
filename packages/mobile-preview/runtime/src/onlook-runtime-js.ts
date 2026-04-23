/**
 * JS fallback for the Overlay ABI v1 `globalThis.OnlookRuntime` host object.
 *
 * Part of two-tier-overlay-v2 task #14 (minimal viable subset).
 *
 * This module installs a JavaScript implementation of the runtime contract
 * on `globalThis.OnlookRuntime`, intended for test harnesses, mobile-preview
 * dev flows, and any environment where the native C++ TurboModule is
 * unavailable. On device, the native installer runs first and sets
 * `__native: true` on the host object; in that case this installer is a
 * no-op (see "guard" below).
 *
 * See `plans/adr/overlay-abi-v1.md` §"Runtime globals" + §"Installation
 * order" for the wire contract. The canonical `OnlookRuntimeApi` type lives
 * in `@onlook/mobile-client-protocol/src/abi-v1.ts`; we define a local
 * structural-compatible interface here because this package does not
 * declare the protocol package as a dependency (the runtime must remain
 * standalone for metro bundling).
 *
 * Scope (v0):
 *   - `require(spec)`  — fully implemented via aliasMap + getMetroModule
 *   - `reportError`    — fully implemented via optional onError callback
 *   - `mountOverlay`   — stub; throws 'not yet implemented in js-fallback v0'
 *   - `unmount`        — no-op
 *   - `resolveAsset`   — stub; throws 'not yet implemented in js-fallback v0'
 *   - `preloadAssets`  — resolves to undefined
 *   - `loadFont`       — resolves to undefined
 *   - `lastMount`      — undefined initially
 *   - `abi` / `impl`   — 'v1' / 'js'
 */

/** The abi-v1 version marker. */
export const ABI_VERSION = 'v1' as const;
export type AbiVersion = typeof ABI_VERSION;

/**
 * Structured runtime-error envelope as consumed by `reportError`.
 * Mirrors the `OnlookRuntimeError` type in `@onlook/mobile-client-protocol`.
 */
export interface OnlookRuntimeError {
    readonly kind: string;
    readonly message: string;
    readonly stack?: string;
    readonly specifier?: string;
    readonly assetId?: string;
}

/**
 * Wire-level runtime contract implemented by both the native TurboModule
 * (`impl: 'native'`) and this JS fallback (`impl: 'js'`).
 */
export interface OnlookRuntimeApi {
    readonly abi: AbiVersion;
    readonly impl: 'native' | 'js';
    readonly __native?: boolean;
    readonly lastMount?: LastMountRecord;
    require(spec: string): unknown;
    reportError(error: OnlookRuntimeError): void;
    mountOverlay(
        source: string,
        props?: Readonly<Record<string, unknown>>,
        assets?: unknown,
    ): void;
    unmount(): void;
    resolveAsset(id: string | number): unknown;
    preloadAssets(ids: readonly (string | number)[]): Promise<void>;
    loadFont(
        family: string,
        ref: string | number,
        opts?: Readonly<Record<string, unknown>>,
    ): Promise<void>;
}

export interface InstallOnlookRuntimeJsOptions {
    readonly aliasMap: ReadonlyMap<string, number>;
    readonly getMetroModule: (moduleId: number) => unknown;
    readonly renderApp?: (
        entry: unknown,
        props: Readonly<Record<string, unknown>>,
    ) => void;
    readonly unmountApp?: () => void;
    readonly onError?: (error: OnlookRuntimeError) => void;
}

/** Matches the OverlayAssetManifest schema from `@onlook/mobile-client-protocol`. */
export interface AssetManifestLike {
    readonly abi: AbiVersion;
    readonly assets: Readonly<Record<string, unknown>>;
}

/** Snapshot of the most recent successful mountOverlay call. */
export interface LastMountRecord {
    readonly source: string;
    readonly props: Readonly<Record<string, unknown>>;
    readonly assets?: AssetManifestLike;
}

/**
 * Install the JS runtime on `globalThis.OnlookRuntime`.
 *
 * Guard: if a native runtime is already installed (`__native === true`),
 * this is a no-op and the existing runtime is returned unchanged — see
 * ADR-0001 §"Installation order".
 *
 * Otherwise constructs the runtime object, installs it, and returns the
 * same object. Subsequent calls will find the JS runtime already present
 * and still return it (idempotent on the first-native-or-JS instance).
 */
export function installOnlookRuntimeJs(
    options: InstallOnlookRuntimeJsOptions,
): OnlookRuntimeApi {
    const host = globalThis as { OnlookRuntime?: OnlookRuntimeApi };
    const existing = host.OnlookRuntime;
    if (existing && existing.__native === true) {
        return existing;
    }

    let currentAssets: AssetManifestLike | undefined;
    let mountedSnapshot: LastMountRecord | undefined;
    const fontRegistry = new Map<string, unknown>();

    const api: OnlookRuntimeApi = {
        abi: ABI_VERSION,
        impl: 'js',
        get lastMount(): LastMountRecord | undefined {
            return mountedSnapshot;
        },
        require(spec: string): unknown {
            const moduleId = options.aliasMap.get(spec);
            if (moduleId === undefined) {
                const message =
                    'OnlookRuntime.require: unknown specifier "' + spec + '"';
                const err = new Error(message) as Error & {
                    __onlookError?: OnlookRuntimeError;
                };
                err.__onlookError = {
                    kind: 'unknown-specifier',
                    message,
                    specifier: spec,
                };
                throw err;
            }
            return options.getMetroModule(moduleId);
        },
        reportError(error: OnlookRuntimeError): void {
            if (options.onError) {
                options.onError(error);
            }
        },
        mountOverlay(
            source: string,
            props?: Readonly<Record<string, unknown>>,
            assets?: unknown,
        ): void {
            const propsValue = props ?? {};
            currentAssets = asAssetManifest(assets);

            // Reset the side-channel before eval so a prior mount's value can't
            // leak into this one if the current overlay fails to publish.
            const hostAny = host as unknown as {
                OnlookRuntime?: { __pendingEntry?: unknown };
            };
            if (hostAny.OnlookRuntime) {
                hostAny.OnlookRuntime.__pendingEntry = undefined;
            }

            // Indirect-eval so the wrap-overlay-v1 IIFE runs in global scope.
            try {
                (0, eval)(source);
            } catch (err) {
                const message = err instanceof Error ? err.message : String(err);
                const runtimeErr: OnlookRuntimeError = {
                    kind: looksLikeSyntaxError(err) ? 'overlay-parse' : 'overlay-runtime',
                    message,
                    stack: err instanceof Error ? err.stack : undefined,
                };
                if (options.onError) options.onError(runtimeErr);
                throw err;
            }

            const entry =
                hostAny.OnlookRuntime && '__pendingEntry' in hostAny.OnlookRuntime
                    ? hostAny.OnlookRuntime.__pendingEntry
                    : undefined;
            if (hostAny.OnlookRuntime) {
                hostAny.OnlookRuntime.__pendingEntry = undefined;
            }
            if (entry === undefined) {
                const runtimeErr: OnlookRuntimeError = {
                    kind: 'overlay-runtime',
                    message:
                        'OnlookRuntime.mountOverlay: overlay did not publish __pendingEntry — check that the source was produced by wrapOverlayV1',
                };
                if (options.onError) options.onError(runtimeErr);
                throw new Error(runtimeErr.message);
            }

            if (options.renderApp) {
                try {
                    options.renderApp(entry, propsValue);
                } catch (err) {
                    const message = err instanceof Error ? err.message : String(err);
                    const runtimeErr: OnlookRuntimeError = {
                        kind: 'overlay-react',
                        message,
                        stack: err instanceof Error ? err.stack : undefined,
                    };
                    if (options.onError) options.onError(runtimeErr);
                    throw err;
                }
            }

            mountedSnapshot = {
                source,
                props: propsValue,
                ...(currentAssets !== undefined ? { assets: currentAssets } : {}),
            };
        },
        unmount(): void {
            if (options.unmountApp) {
                options.unmountApp();
            }
            mountedSnapshot = undefined;
            currentAssets = undefined;
        },
        resolveAsset(id: string | number): unknown {
            const assetId = String(id);
            const manifest = currentAssets?.assets;
            if (manifest === undefined || !(assetId in manifest)) {
                const message =
                    'OnlookRuntime.resolveAsset: unknown assetId "' + assetId + '"';
                const err = new Error(message) as Error & {
                    __onlookError?: OnlookRuntimeError;
                };
                err.__onlookError = {
                    kind: 'asset-missing',
                    message,
                    assetId,
                };
                throw err;
            }
            return manifest[assetId];
        },
        preloadAssets(ids: readonly (string | number)[]): Promise<void> {
            // v1 js-fallback: verify each id is present in the currently-mounted
            // manifest. Throws asset-missing on any unknown id so the editor
            // surfaces the issue synchronously rather than at first use.
            const manifest = currentAssets?.assets;
            for (const id of ids) {
                const assetId = String(id);
                if (manifest === undefined || !(assetId in manifest)) {
                    const message =
                        'OnlookRuntime.preloadAssets: unknown assetId "' + assetId + '"';
                    const err = new Error(message) as Error & {
                        __onlookError?: OnlookRuntimeError;
                    };
                    err.__onlookError = { kind: 'asset-missing', message, assetId };
                    return Promise.reject(err);
                }
            }
            return Promise.resolve();
        },
        loadFont(
            family: string,
            ref: string | number,
            opts?: Readonly<Record<string, unknown>>,
        ): Promise<void> {
            const refId = String(ref);
            const manifest = currentAssets?.assets;
            const descriptor = manifest?.[refId] as { kind?: string } | undefined;
            if (descriptor === undefined) {
                const message =
                    'OnlookRuntime.loadFont: unknown assetRef "' + refId + '"';
                const err = new Error(message) as Error & {
                    __onlookError?: OnlookRuntimeError;
                };
                err.__onlookError = { kind: 'asset-missing', message, assetId: refId };
                return Promise.reject(err);
            }
            if (descriptor.kind !== 'font') {
                const message =
                    'OnlookRuntime.loadFont: asset "' + refId + '" is not kind:font (got ' + String(descriptor.kind) + ')';
                const err = new Error(message) as Error & {
                    __onlookError?: OnlookRuntimeError;
                };
                err.__onlookError = { kind: 'asset-load-failed', message, assetId: refId };
                return Promise.reject(err);
            }
            const weight = typeof opts?.weight === 'number' ? (opts.weight as number) : 400;
            const style = opts?.style === 'italic' ? 'italic' : 'normal';
            fontRegistry.set(`${family}|${weight}|${style}`, descriptor);
            return Promise.resolve();
        },
    };

    host.OnlookRuntime = api;
    return api;
}

function asAssetManifest(value: unknown): AssetManifestLike | undefined {
    if (value === undefined || value === null) return undefined;
    if (typeof value !== 'object') return undefined;
    const v = value as { abi?: unknown; assets?: unknown };
    if (v.abi === 'v1' && typeof v.assets === 'object' && v.assets !== null) {
        return { abi: 'v1', assets: v.assets as Record<string, unknown> };
    }
    return undefined;
}

function looksLikeSyntaxError(err: unknown): boolean {
    if (err instanceof SyntaxError) return true;
    const name = (err as { name?: unknown })?.name;
    return typeof name === 'string' && name === 'SyntaxError';
}

/**
 * Test-only reset hook. Removes the installed runtime from `globalThis`
 * so the next `installOnlookRuntimeJs` call creates a fresh instance.
 * Not exported from the package index intentionally — only the test
 * harness should pull it via a direct file-path import.
 */
export function __testResetOnlookRuntime(): void {
    (globalThis as { OnlookRuntime?: unknown }).OnlookRuntime = undefined;
}
