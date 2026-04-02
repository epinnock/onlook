import { CodeProvider } from './providers';
import {
    CloudflareSandboxProvider,
    type CloudflareProviderOptions,
} from './providers/cloudflare';
import { CodesandboxProvider, type CodesandboxProviderOptions } from './providers/codesandbox';
import { NodeFsProvider, type NodeFsProviderOptions } from './providers/nodefs';
export * from './providers';
export { CloudflareSandboxProvider } from './providers/cloudflare';
export { CodesandboxProvider } from './providers/codesandbox';
export { NodeFsProvider } from './providers/nodefs';
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
): Promise<typeof CloudflareSandboxProvider | typeof CodesandboxProvider | typeof NodeFsProvider> {
    if (codeProvider === CodeProvider.Cloudflare) {
        return CloudflareSandboxProvider;
    }

    if (codeProvider === CodeProvider.CodeSandbox) {
        return CodesandboxProvider;
    }

    if (codeProvider === CodeProvider.NodeFs) {
        return NodeFsProvider;
    }
    throw new Error(`Unimplemented code provider: ${codeProvider}`);
}

export interface ProviderInstanceOptions {
    cloudflare?: CloudflareProviderOptions;
    codesandbox?: CodesandboxProviderOptions;
    nodefs?: NodeFsProviderOptions;
}

function newProviderInstance(codeProvider: CodeProvider, providerOptions: ProviderInstanceOptions) {
    if (codeProvider === CodeProvider.Cloudflare) {
        if (!providerOptions.cloudflare) {
            throw new Error('Cloudflare provider options are required.');
        }
        return new CloudflareSandboxProvider(providerOptions.cloudflare);
    }

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

    throw new Error(`Unimplemented code provider: ${codeProvider}`);
}
