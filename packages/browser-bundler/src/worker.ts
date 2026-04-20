import { bundleBrowserProject, type BrowserBundlerEsbuildService } from './bundle';
import {
    BROWSER_BUNDLER_WORKER_ERROR_TYPE,
    BROWSER_BUNDLER_WORKER_SUCCESS_TYPE,
    normalizeBrowserBundlerError,
    type BrowserBundlerWorkerBundleErrorResponse,
    type BrowserBundlerWorkerBundleSuccessResponse,
    type BrowserBundlerWorkerRequest,
    type BrowserBundlerWorkerResponse,
    parseBrowserBundlerWorkerRequest,
} from './worker-protocol';

export interface BrowserBundlerWorkerDependencies {
    readonly esbuild: BrowserBundlerEsbuildService;
}

export interface BrowserBundlerWorkerMessageEventLike {
    readonly data: unknown;
}

export interface BrowserBundlerWorkerRuntime {
    readonly handleMessage: (
        message: unknown,
    ) => Promise<BrowserBundlerWorkerResponse | null>;
    readonly handleEvent: (event: BrowserBundlerWorkerMessageEventLike) => Promise<void>;
}

export type BrowserBundlerWorkerPoster = (
    message: BrowserBundlerWorkerResponse,
) => void | Promise<void>;

export async function handleParsedBrowserBundlerWorkerRequest(
    request: BrowserBundlerWorkerRequest,
    dependencies: BrowserBundlerWorkerDependencies,
): Promise<BrowserBundlerWorkerResponse> {
    try {
        const result = await bundleBrowserProject(request.options, dependencies.esbuild);

        return createBrowserBundlerWorkerSuccessResponse(request.requestId, result);
    } catch (error: unknown) {
        return createBrowserBundlerWorkerErrorResponse(request.requestId, error);
    }
}

export async function handleBrowserBundlerWorkerMessage(
    message: unknown,
    dependencies: BrowserBundlerWorkerDependencies,
): Promise<BrowserBundlerWorkerResponse | null> {
    const request = parseBrowserBundlerWorkerRequest(message);
    if (!request) {
        return null;
    }

    return handleParsedBrowserBundlerWorkerRequest(request, dependencies);
}

export function createBrowserBundlerWorkerRuntime(
    dependencies: BrowserBundlerWorkerDependencies,
    postMessage?: BrowserBundlerWorkerPoster,
): BrowserBundlerWorkerRuntime {
    const handleMessage = async (
        message: unknown,
    ): Promise<BrowserBundlerWorkerResponse | null> => {
        return handleBrowserBundlerWorkerMessage(message, dependencies);
    };

    const handleEvent = async (event: BrowserBundlerWorkerMessageEventLike): Promise<void> => {
        const response = await handleMessage(event.data);
        if (response && postMessage) {
            await postMessage(response);
        }
    };

    return {
        handleMessage,
        handleEvent,
    };
}

function createBrowserBundlerWorkerSuccessResponse(
    requestId: string,
    result: Awaited<ReturnType<typeof bundleBrowserProject>>,
): BrowserBundlerWorkerBundleSuccessResponse {
    return {
        type: BROWSER_BUNDLER_WORKER_SUCCESS_TYPE,
        requestId,
        code: result.code,
        sourceMap: result.sourceMap,
        warnings: result.warnings,
    };
}

function createBrowserBundlerWorkerErrorResponse(
    requestId: string,
    error: unknown,
): BrowserBundlerWorkerBundleErrorResponse {
    return {
        type: BROWSER_BUNDLER_WORKER_ERROR_TYPE,
        requestId,
        error: normalizeBrowserBundlerError(error),
    };
}
