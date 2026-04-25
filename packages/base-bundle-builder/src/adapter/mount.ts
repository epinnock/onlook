import { getAliasMapModuleId, type AliasMap } from './alias-map';

export interface AdapterOverlayMountOptions {
    readonly aliasMap: AliasMap;
    readonly metroRequire: (moduleId: number) => unknown;
}

export type AdapterOverlayMount = (source: string) => unknown;
type AdapterOverlayRequire = (specifier: string) => unknown;

const RELATIVE_SPECIFIER_ERROR_PREFIX =
    'Adapter overlay evaluator does not yet support relative module specifiers';

export function createAdapterOverlayMount(
    options: AdapterOverlayMountOptions,
): AdapterOverlayMount {
    const moduleCache = new Map<number, unknown>();

    return (source: string) => {
        const module = {
            exports: {},
        };

        const require = (specifier: string): unknown => {
            if (isRelativeSpecifier(specifier)) {
                throw new Error(`${RELATIVE_SPECIFIER_ERROR_PREFIX}: "${specifier}"`);
            }

            const moduleId = getAliasMapModuleId(options.aliasMap, specifier);
            if (moduleCache.has(moduleId)) {
                return moduleCache.get(moduleId);
            }

            const exports = options.metroRequire(moduleId);
            moduleCache.set(moduleId, exports);
            return exports;
        };

        const evaluator = new Function(
            'require',
            'module',
            'exports',
            source,
        ) as (
            require: AdapterOverlayRequire,
            module: { exports: unknown },
            exports: unknown,
        ) => unknown;

        evaluator(require, module, module.exports);
        return module.exports;
    };
}

function isRelativeSpecifier(specifier: string): boolean {
    return specifier.startsWith('.') || specifier.startsWith('/');
}
