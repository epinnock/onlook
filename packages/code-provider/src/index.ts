import { CodeProvider } from './providers';
import { CodesandboxProvider, type CodesandboxProviderOptions } from './providers/codesandbox';
export * from './providers';
export { CodesandboxProvider } from './providers/codesandbox';
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
    if (codeProvider !== CodeProvider.CodeSandbox) {
        throw new Error(`Provider ${codeProvider} is server-side only. Use the tRPC sandbox API.`);
    }
    const provider = new CodesandboxProvider(providerOptions.codesandbox!);
    await provider.initialize({});
    return provider;
}

export async function getStaticCodeProvider(
    codeProvider: CodeProvider,
): Promise<typeof CodesandboxProvider> {
    if (codeProvider === CodeProvider.CodeSandbox) {
        return CodesandboxProvider;
    }
    throw new Error(`Provider ${codeProvider} is server-side only.`);
}

export interface ProviderInstanceOptions {
    codesandbox?: CodesandboxProviderOptions;
}
