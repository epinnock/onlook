import { resolveEsbuildWasmPath, type ResolveEsbuildWasmPathOptions } from './esbuild-path';

export interface EsbuildLoaderInitContext {
    wasmPath: string;
}

export type EsbuildLoaderInitializer<TService> = (context: EsbuildLoaderInitContext) => Promise<TService> | TService;

export interface CreateEsbuildLoaderOptions<TService> extends ResolveEsbuildWasmPathOptions {
    initialize: EsbuildLoaderInitializer<TService>;
}

export interface EsbuildLoader<TService> {
    load: () => Promise<TService>;
    reset: () => void;
}

export function createEsbuildLoader<TService>(options: CreateEsbuildLoaderOptions<TService>): EsbuildLoader<TService> {
    const { initialize, ...pathOptions } = options;

    let servicePromise: Promise<TService> | undefined;

    const load = (): Promise<TService> => {
        if (servicePromise) {
            return servicePromise;
        }

        const loadingPromise = Promise.resolve().then(() => {
            const wasmPath = resolveEsbuildWasmPath(pathOptions);

            return initialize({ wasmPath });
        });
        const wrappedPromise = loadingPromise.catch((error: unknown) => {
            if (servicePromise === wrappedPromise) {
                servicePromise = undefined;
            }

            throw error;
        });
        servicePromise = wrappedPromise;

        return wrappedPromise;
    };

    const reset = (): void => {
        servicePromise = undefined;
    };

    return { load, reset };
}
