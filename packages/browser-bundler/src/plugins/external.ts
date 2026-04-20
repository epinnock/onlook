export interface ExternalPluginOptions {
    readonly externalSpecifiers: Iterable<string>;
}

export interface EsbuildResolveArgs {
    readonly path: string;
}

export interface EsbuildResolveResult {
    readonly path?: string;
    readonly external?: boolean;
    readonly errors?: readonly { text: string }[];
}

export interface EsbuildPluginBuild {
    onResolve(
        options: { filter: RegExp },
        callback: (args: EsbuildResolveArgs) => EsbuildResolveResult | undefined,
    ): void;
}

export interface EsbuildPlugin {
    readonly name: string;
    setup(build: EsbuildPluginBuild): void;
}

export type ImportClassification = 'local' | 'external' | 'unsupported-bare';

export function createExternalSpecifierSet(
    specifiers: Iterable<string>,
): ReadonlySet<string> {
    const externalSpecifiers = new Set<string>();

    for (const specifier of specifiers) {
        if (specifier.trim().length === 0) {
            throw new Error('External specifier must be a non-empty string');
        }
        externalSpecifiers.add(specifier);
    }

    return externalSpecifiers;
}

export function classifyImportPath(
    importPath: string,
    externalSpecifiers: ReadonlySet<string>,
): ImportClassification {
    if (!isBareImport(importPath)) {
        return 'local';
    }

    return externalSpecifiers.has(importPath) ? 'external' : 'unsupported-bare';
}

export function createExternalPlugin(options: ExternalPluginOptions): EsbuildPlugin {
    const externalSpecifiers = createExternalSpecifierSet(options.externalSpecifiers);

    return {
        name: 'onlook-external-base-bundle-imports',
        setup(build) {
            build.onResolve({ filter: /.*/ }, (args) => {
                const classification = classifyImportPath(args.path, externalSpecifiers);

                if (classification === 'local') {
                    return undefined;
                }

                if (classification === 'external') {
                    return {
                        path: args.path,
                        external: true,
                    };
                }

                return {
                    errors: [
                        {
                            text: `Unsupported bare import "${args.path}". Add it to the base bundle or rewrite it as a local import.`,
                        },
                    ],
                };
            });
        },
    };
}

function isBareImport(importPath: string): boolean {
    return (
        !importPath.startsWith('.') &&
        !importPath.startsWith('/') &&
        !importPath.startsWith('\0')
    );
}
