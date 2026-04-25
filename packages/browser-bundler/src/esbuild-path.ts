export type EsbuildWasmPathLike = string | URL;

export interface EsbuildWasmPathScope {
    [key: string]: unknown;
}

export interface ResolveEsbuildWasmPathOptions {
    path?: EsbuildWasmPathLike | null;
    defaultPath?: EsbuildWasmPathLike | null;
    scope?: EsbuildWasmPathScope;
    globalKey?: string;
}

export interface SetEsbuildWasmPathOptions {
    scope?: EsbuildWasmPathScope;
    globalKey?: string;
}

export const ESBUILD_WASM_PATH_GLOBAL_KEY = '__ONLOOK_ESBUILD_WASM_PATH__';

function isURL(value: unknown): value is URL {
    return value instanceof URL;
}

function normalizePath(value: EsbuildWasmPathLike | null | undefined, label: string): string | undefined {
    if (value == null) {
        return undefined;
    }

    if (isURL(value)) {
        return value.href;
    }

    if (typeof value === 'string') {
        if (value.trim().length === 0) {
            throw new TypeError(`${label} must be a non-empty string or URL.`);
        }

        return value;
    }

    throw new TypeError(`${label} must be a string or URL.`);
}

function readPathFromScope(scope: EsbuildWasmPathScope | undefined, globalKey: string): string | undefined {
    if (!scope) {
        return undefined;
    }

    return normalizePath(scope[globalKey] as EsbuildWasmPathLike | undefined, `globalThis[${JSON.stringify(globalKey)}]`);
}

export function getEsbuildWasmPath(options: SetEsbuildWasmPathOptions = {}): string | undefined {
    const { scope = globalThis as EsbuildWasmPathScope, globalKey = ESBUILD_WASM_PATH_GLOBAL_KEY } = options;

    return readPathFromScope(scope, globalKey);
}

export function setEsbuildWasmPath(path: EsbuildWasmPathLike, options: SetEsbuildWasmPathOptions = {}): string {
    const { scope = globalThis as EsbuildWasmPathScope, globalKey = ESBUILD_WASM_PATH_GLOBAL_KEY } = options;
    const normalized = normalizePath(path, 'path');

    if (normalized == null) {
        throw new TypeError('path must be a non-empty string or URL.');
    }

    scope[globalKey] = normalized;

    return normalized;
}

export function resolveEsbuildWasmPath(options: ResolveEsbuildWasmPathOptions = {}): string {
    const { path, defaultPath, scope = globalThis as EsbuildWasmPathScope, globalKey = ESBUILD_WASM_PATH_GLOBAL_KEY } = options;
    const explicitPath = normalizePath(path, 'path');

    if (explicitPath) {
        return explicitPath;
    }

    const fallbackPath = normalizePath(defaultPath, 'defaultPath');

    if (fallbackPath) {
        return fallbackPath;
    }

    const globalPath = readPathFromScope(scope, globalKey);

    if (globalPath) {
        return globalPath;
    }

    throw new Error(
        `Missing esbuild-wasm browser asset URL. Pass { path }, { defaultPath }, or set globalThis[${JSON.stringify(globalKey)}].`,
    );
}
