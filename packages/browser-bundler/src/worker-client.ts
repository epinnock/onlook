import type { CreateBrowserBundleOptionsInput } from './options';
import {
    BROWSER_BUNDLER_WORKER_REQUEST_TYPE,
    BROWSER_BUNDLER_WORKER_SUCCESS_TYPE,
    parseBrowserBundlerWorkerResponse,
    type BrowserBundlerNormalizedError,
    type BrowserBundlerWorkerBundleRequest,
} from './worker-protocol';
import type { BundleBrowserProjectResult } from './bundle';

export interface BrowserBundlerWorkerMessageEventLike {
    readonly data: unknown;
}

export interface BrowserBundlerWorkerMessageListener {
    (event: BrowserBundlerWorkerMessageEventLike): void;
}

export interface BrowserBundlerWorkerLike {
    postMessage(message: BrowserBundlerWorkerBundleRequest): void;
    addEventListener(type: 'message', listener: BrowserBundlerWorkerMessageListener): void;
    removeEventListener(type: 'message', listener: BrowserBundlerWorkerMessageListener): void;
}

export interface BrowserBundlerWorkerClientDependencies {
    readonly createRequestId?: () => string;
}

export interface BrowserBundlerWorkerClient {
    bundle(options: CreateBrowserBundleOptionsInput): Promise<BundleBrowserProjectResult>;
    dispose(): void;
}

interface PendingRequest {
    readonly resolve: (result: BundleBrowserProjectResult) => void;
    readonly reject: (error: Error) => void;
}

export function createBrowserBundlerWorkerClient(
    worker: BrowserBundlerWorkerLike,
    dependencies: BrowserBundlerWorkerClientDependencies = {},
): BrowserBundlerWorkerClient {
    const pendingRequests = new Map<string, PendingRequest>();
    const createRequestId = dependencies.createRequestId ?? createDefaultRequestId;

    const handleMessage = (event: BrowserBundlerWorkerMessageEventLike): void => {
        const response = parseBrowserBundlerWorkerResponse(event.data);
        if (!response) {
            return;
        }

        const pendingRequest = pendingRequests.get(response.requestId);
        if (!pendingRequest) {
            return;
        }

        pendingRequests.delete(response.requestId);

        if (response.type === BROWSER_BUNDLER_WORKER_SUCCESS_TYPE) {
            pendingRequest.resolve({
                code: response.code,
                sourceMap: response.sourceMap,
                warnings: response.warnings,
            });
            return;
        }

        pendingRequest.reject(createBrowserBundlerWorkerError(response.error));
    };

    worker.addEventListener('message', handleMessage);

    return {
        bundle(options: CreateBrowserBundleOptionsInput): Promise<BundleBrowserProjectResult> {
            const requestId = createRequestId();

            return new Promise<BundleBrowserProjectResult>((resolve, reject) => {
                const request: BrowserBundlerWorkerBundleRequest = {
                    type: BROWSER_BUNDLER_WORKER_REQUEST_TYPE,
                    requestId,
                    options,
                };

                pendingRequests.set(requestId, { resolve, reject });

                try {
                    worker.postMessage(request);
                } catch (error: unknown) {
                    pendingRequests.delete(requestId);
                    reject(createBrowserBundlerWorkerError(normalizeError(error)));
                }
            });
        },
        dispose(): void {
            worker.removeEventListener('message', handleMessage);

            for (const pendingRequest of pendingRequests.values()) {
                pendingRequest.reject(
                    new Error('Browser bundler worker client was disposed before completion'),
                );
            }

            pendingRequests.clear();
        },
    };
}

function createBrowserBundlerWorkerError(error: BrowserBundlerNormalizedError): Error {
    const result = new Error(error.message);
    result.name = error.name;

    if (error.stack) {
        result.stack = error.stack;
    }

    return result;
}

function normalizeError(error: unknown): BrowserBundlerNormalizedError {
    if (error instanceof Error) {
        return {
            name: error.name || 'Error',
            message: error.message || 'Unknown error',
            stack: error.stack,
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

function createDefaultRequestId(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }

    return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}
