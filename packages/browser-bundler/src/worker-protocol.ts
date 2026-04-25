import type { CreateBrowserBundleOptionsInput } from './options';

export const BROWSER_BUNDLER_WORKER_REQUEST_TYPE = 'bundle';
export const BROWSER_BUNDLER_WORKER_SUCCESS_TYPE = 'bundle:success';
export const BROWSER_BUNDLER_WORKER_ERROR_TYPE = 'bundle:error';

export interface BrowserBundlerWorkerBundleRequest {
    readonly type: typeof BROWSER_BUNDLER_WORKER_REQUEST_TYPE;
    readonly requestId: string;
    readonly options: CreateBrowserBundleOptionsInput;
}

export interface BrowserBundlerNormalizedError {
    readonly name: string;
    readonly message: string;
    readonly stack?: string;
}

export interface BrowserBundlerWorkerBundleSuccessResponse {
    readonly type: typeof BROWSER_BUNDLER_WORKER_SUCCESS_TYPE;
    readonly requestId: string;
    readonly code: string;
    readonly sourceMap?: string;
    readonly warnings: readonly unknown[];
}

export interface BrowserBundlerWorkerBundleErrorResponse {
    readonly type: typeof BROWSER_BUNDLER_WORKER_ERROR_TYPE;
    readonly requestId: string;
    readonly error: BrowserBundlerNormalizedError;
}

export type BrowserBundlerWorkerRequest = BrowserBundlerWorkerBundleRequest;
export type BrowserBundlerWorkerResponse =
    | BrowserBundlerWorkerBundleSuccessResponse
    | BrowserBundlerWorkerBundleErrorResponse;
export type BrowserBundlerWorkerMessage = BrowserBundlerWorkerRequest | BrowserBundlerWorkerResponse;

export function isBrowserBundlerWorkerRequest(
    value: unknown,
): value is BrowserBundlerWorkerRequest {
    return (
        isRecord(value) &&
        value.type === BROWSER_BUNDLER_WORKER_REQUEST_TYPE &&
        isNonEmptyString(value.requestId) &&
        isCreateBrowserBundleOptionsInput(value.options)
    );
}

export function isBrowserBundlerWorkerResponse(
    value: unknown,
): value is BrowserBundlerWorkerResponse {
    return (
        isBrowserBundlerWorkerSuccessResponse(value) ||
        isBrowserBundlerWorkerErrorResponse(value)
    );
}

export function isBrowserBundlerWorkerSuccessResponse(
    value: unknown,
): value is BrowserBundlerWorkerBundleSuccessResponse {
    return (
        isRecord(value) &&
        value.type === BROWSER_BUNDLER_WORKER_SUCCESS_TYPE &&
        isNonEmptyString(value.requestId) &&
        typeof value.code === 'string' &&
        (value.sourceMap === undefined || typeof value.sourceMap === 'string') &&
        Array.isArray(value.warnings)
    );
}

export function isBrowserBundlerWorkerErrorResponse(
    value: unknown,
): value is BrowserBundlerWorkerBundleErrorResponse {
    return (
        isRecord(value) &&
        value.type === BROWSER_BUNDLER_WORKER_ERROR_TYPE &&
        isNonEmptyString(value.requestId) &&
        isBrowserBundlerNormalizedError(value.error)
    );
}

export function parseBrowserBundlerWorkerRequest(
    value: unknown,
): BrowserBundlerWorkerRequest | null {
    return isBrowserBundlerWorkerRequest(value) ? value : null;
}

export function parseBrowserBundlerWorkerResponse(
    value: unknown,
): BrowserBundlerWorkerResponse | null {
    return isBrowserBundlerWorkerResponse(value) ? value : null;
}

export function normalizeBrowserBundlerError(error: unknown): BrowserBundlerNormalizedError {
    if (error instanceof Error) {
        return {
            name: error.name || 'Error',
            message: error.message || 'Unknown error',
            stack: error.stack,
        };
    }

    if (isRecord(error)) {
        const name = typeof error.name === 'string' && error.name.trim().length > 0
            ? error.name
            : 'Error';
        const message = typeof error.message === 'string' && error.message.trim().length > 0
            ? error.message
            : 'Unknown error';
        const stack = typeof error.stack === 'string' && error.stack.trim().length > 0
            ? error.stack
            : undefined;

        return {
            name,
            message,
            stack,
        };
    }

    if (typeof error === 'string' && error.trim().length > 0) {
        return {
            name: 'Error',
            message: error,
        };
    }

    return {
        name: 'Error',
        message: 'Unknown error',
    };
}

export function isBrowserBundlerNormalizedError(
    value: unknown,
): value is BrowserBundlerNormalizedError {
    return (
        isRecord(value) &&
        isNonEmptyString(value.name) &&
        isNonEmptyString(value.message) &&
        (value.stack === undefined || typeof value.stack === 'string')
    );
}

function isCreateBrowserBundleOptionsInput(
    value: unknown,
): value is CreateBrowserBundleOptionsInput {
    return (
        isRecord(value) &&
        isNonEmptyString(value.entryPoint) &&
        Array.isArray(value.files) &&
        value.files.every(isBrowserBundlerVirtualFile) &&
        isStringIterable(value.externalSpecifiers) &&
        (value.platform === undefined || value.platform === 'ios' || value.platform === 'android') &&
        (value.minify === undefined || typeof value.minify === 'boolean') &&
        (value.sourcemap === undefined || typeof value.sourcemap === 'boolean') &&
        (value.wasmUrl === undefined ||
            typeof value.wasmUrl === 'string' ||
            value.wasmUrl instanceof URL)
    );
}

function isBrowserBundlerVirtualFile(value: unknown): value is CreateBrowserBundleOptionsInput['files'][number] {
    return (
        isRecord(value) &&
        isNonEmptyString(value.path) &&
        typeof value.contents === 'string'
    );
}

function isStringIterable(value: unknown): value is Iterable<string> {
    if (typeof value === 'string') {
        return false;
    }

    if (!value || typeof value !== 'object') {
        return false;
    }

    const iterator = (value as { readonly [Symbol.iterator]?: unknown })[Symbol.iterator];
    if (typeof iterator !== 'function') {
        return false;
    }

    try {
        for (const item of value as Iterable<unknown>) {
            if (typeof item !== 'string') {
                return false;
            }
        }
        return true;
    } catch {
        return false;
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
    return typeof value === 'string' && value.trim().length > 0;
}
