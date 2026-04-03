import { CodeProvider } from './providers';
import { CodesandboxProvider, type CodesandboxProviderOptions } from './providers/codesandbox';
import { NodeFsProvider, type NodeFsProviderOptions } from './providers/nodefs';
import { SnackProvider } from './providers/snack';
import type { SnackProviderOptions } from './providers/snack/types';
export * from './providers';
export { CodesandboxProvider } from './providers/codesandbox';
export { NodeFsProvider } from './providers/nodefs';
export { SnackProvider } from './providers/snack';
export * from './types';

export interface CreateClientOptions {
    providerOptions: ProviderInstanceOptions;
}

/**
 * Providers are designed to be singletons; be mindful of this when creating multiple clients
 * or when instantiating in the backend (stateless vs stateful).
 */
export async function createCodeProviderClient(
    codeProvider: CodeProvider,
    { providerOptions }: CreateClientOptions,
) {
    const provider = newProviderInstance(codeProvider, providerOptions);
    await provider.initialize({});
    return provider;
}

export async function getStaticCodeProvider(
    codeProvider: CodeProvider,
): Promise<typeof CodesandboxProvider | typeof NodeFsProvider> {
    if (codeProvider === CodeProvider.CodeSandbox) {
        return CodesandboxProvider;
    }

    if (codeProvider === CodeProvider.NodeFs) {
        return NodeFsProvider;
    }

    if (codeProvider === CodeProvider.ExpoSnack) {
        return SnackProvider as any;
    }
    throw new Error(`Unimplemented code provider: ${codeProvider}`);
}

export interface ProviderInstanceOptions {
    codesandbox?: CodesandboxProviderOptions;
    nodefs?: NodeFsProviderOptions;
    snack?: SnackProviderOptions;
}

function newProviderInstance(codeProvider: CodeProvider, providerOptions: ProviderInstanceOptions) {
    if (codeProvider === CodeProvider.CodeSandbox) {
        if (!providerOptions.codesandbox) {
            throw new Error('Codesandbox provider options are required.');
        }
        return new CodesandboxProvider(providerOptions.codesandbox);
    }

    if (codeProvider === CodeProvider.NodeFs) {
        if (!providerOptions.nodefs) {
            throw new Error('NodeFs provider options are required.');
        }
        return new NodeFsProvider(providerOptions.nodefs);
    }

    if (codeProvider === CodeProvider.ExpoSnack) {
        if (!providerOptions.snack) {
            throw new Error('Snack provider options are required.');
        }
        return new SnackProvider(providerOptions.snack) as any;
    }

    throw new Error(`Unimplemented code provider: ${codeProvider}`);
}
