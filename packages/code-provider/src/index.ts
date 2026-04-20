import { CodeProvider } from './providers';
import type { CloudflareProviderOptions } from './providers/cloudflare/types';
import { CodesandboxProvider, type CodesandboxProviderOptions } from './providers/codesandbox';
import { ExpoBrowserProvider, type ExpoBrowserProviderOptions } from './providers/expo-browser';
import { NodeFsProvider, type NodeFsProviderOptions } from './providers/nodefs';
export * from './providers';
export type { CloudflareProviderOptions } from './providers/cloudflare/types';
export { CodesandboxProvider } from './providers/codesandbox';
export {
    EXPO_BROWSER_TEMPLATES,
    ExpoBrowserProvider,
    expoBlankTemplate,
    PROVIDER_NO_SHELL,
    seedExpoBrowserStorage,
} from './providers/expo-browser';
export type {
    ExpoBrowserTemplateFile,
    ExpoBrowserTemplateId,
    SeedExpoBrowserStorageOptions,
    SeedExpoBrowserStorageResult,
} from './providers/expo-browser';
export type { ExpoBrowserProviderOptions } from './providers/expo-browser/types';
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
    const provider = await newProviderInstance(codeProvider, providerOptions);
    await provider.initialize({});
    return provider;
}

export async function getStaticCodeProvider(
    codeProvider: CodeProvider,
) {
    if (codeProvider === CodeProvider.Cloudflare) {
        const { CloudflareSandboxProvider } = await import('./providers/cloudflare');
        return CloudflareSandboxProvider;
    }

    if (codeProvider === CodeProvider.CodeSandbox) {
        return CodesandboxProvider;
    }

    if (codeProvider === CodeProvider.NodeFs) {
        return NodeFsProvider;
    }

    if (codeProvider === CodeProvider.ExpoBrowser) {
        return ExpoBrowserProvider;
    }
    throw new Error(`Unimplemented code provider: ${codeProvider}`);
}

export interface ProviderInstanceOptions {
    cloudflare?: CloudflareProviderOptions;
    codesandbox?: CodesandboxProviderOptions;
    expoBrowser?: ExpoBrowserProviderOptions;
    nodefs?: NodeFsProviderOptions;
}

async function newProviderInstance(codeProvider: CodeProvider, providerOptions: ProviderInstanceOptions) {
    if (codeProvider === CodeProvider.Cloudflare) {
        if (!providerOptions.cloudflare) {
            throw new Error('Cloudflare provider options are required.');
        }
        const { CloudflareSandboxProvider } = await import('./providers/cloudflare');
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

    if (codeProvider === CodeProvider.ExpoBrowser) {
        if (!providerOptions.expoBrowser) {
            throw new Error('ExpoBrowser provider options are required.');
        }
        return new ExpoBrowserProvider(providerOptions.expoBrowser);
    }

    throw new Error(`Unimplemented code provider: ${codeProvider}`);
}
