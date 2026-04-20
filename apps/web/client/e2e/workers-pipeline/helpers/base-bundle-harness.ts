type HarnessModuleFactory = (
    require: (specifier: string) => unknown,
    module: { exports: unknown },
    exports: Record<string, unknown>,
) => void;

export interface BaseBundleHarness {
    readonly aliases: Readonly<Record<string, number>>;
    readonly mountedOverlays: string[];
    requireBaseModule(specifier: string): unknown;
    mountOverlay(source: string): unknown;
}

const DEFAULT_ALIASES: Record<string, number> = {
    react: 1,
    'react/jsx-runtime': 2,
    'react-native': 3,
    'expo-status-bar': 4,
    'react-native-safe-area-context': 5,
};

export function createBaseBundleHarness(
    modules: Record<string, unknown> = {},
): BaseBundleHarness {
    const mountedOverlays: string[] = [];
    const moduleTable = new Map<string, unknown>(Object.entries(modules));

    for (const specifier of Object.keys(DEFAULT_ALIASES)) {
        if (!moduleTable.has(specifier)) {
            moduleTable.set(specifier, { __specifier: specifier });
        }
    }

    const requireBaseModule = (specifier: string): unknown => {
        if (!moduleTable.has(specifier)) {
            throw new Error(`Unknown base-bundle import: ${specifier}`);
        }
        return moduleTable.get(specifier);
    };

    return {
        aliases: DEFAULT_ALIASES,
        mountedOverlays,
        requireBaseModule,
        mountOverlay(source: string): unknown {
            mountedOverlays.push(source);
            const module = { exports: {} as Record<string, unknown> };
            const factory = new Function(
                'require',
                'module',
                'exports',
                source,
            ) as HarnessModuleFactory;
            factory(requireBaseModule, module, module.exports);
            return module.exports;
        },
    };
}

export function createOverlaySource(specifier: string): string {
    return [
        `const imported = require(${JSON.stringify(specifier)});`,
        'module.exports = { imported };',
    ].join('\n');
}

