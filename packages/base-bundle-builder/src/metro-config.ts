import path from 'node:path';

import { listCuratedBaseBundleDependencies } from './deps';
import type { BaseBundleBuildOptions } from './options';

export interface BaseBundleMetroCacheStore {
    readonly type: 'fs';
    readonly root: string;
}

export interface BaseBundleMetroResolverConfig {
    readonly extraNodeModules: Readonly<Record<string, string>>;
    readonly nodeModulesPaths: readonly string[];
    readonly disableHierarchicalLookup: boolean;
    readonly platforms: readonly BaseBundleBuildOptions['platform'][];
}

export interface BaseBundleMetroTransformerConfig {
    readonly dev: boolean;
    readonly minify: boolean;
    readonly inlineRequires: boolean;
    readonly unstable_allowRequireContext: boolean;
}

export interface BaseBundleMetroConfig {
    readonly projectRoot: string;
    readonly watchFolders: readonly string[];
    readonly resolver: BaseBundleMetroResolverConfig;
    readonly transformer: BaseBundleMetroTransformerConfig;
    readonly cacheVersion: string;
    readonly cacheDir?: string;
    readonly cacheStores?: readonly BaseBundleMetroCacheStore[];
    readonly platform: BaseBundleBuildOptions['platform'];
    readonly dev: boolean;
    readonly minify: boolean;
}

export function createBaseBundleMetroConfig(
    options: BaseBundleBuildOptions,
): BaseBundleMetroConfig {
    const nodeModulesRoot = path.join(options.projectRoot, 'node_modules');
    const cacheStores = options.cacheDir
        ? [{ type: 'fs' as const, root: options.cacheDir }]
        : undefined;

    return {
        projectRoot: options.projectRoot,
        watchFolders: uniquePaths([options.projectRoot, options.outputDir]),
        resolver: {
            extraNodeModules: createExtraNodeModules(nodeModulesRoot),
            nodeModulesPaths: [nodeModulesRoot],
            disableHierarchicalLookup: true,
            platforms: [options.platform],
        },
        transformer: {
            dev: options.dev,
            minify: options.minify,
            inlineRequires: !options.dev,
            unstable_allowRequireContext: false,
        },
        cacheVersion: createCacheVersion(options),
        cacheDir: options.cacheDir,
        cacheStores,
        platform: options.platform,
        dev: options.dev,
        minify: options.minify,
    };
}

function createExtraNodeModules(
    nodeModulesRoot: string,
): Readonly<Record<string, string>> {
    const entries = listCuratedBaseBundleDependencies().map(({ packageName }) => [
        packageName,
        path.join(nodeModulesRoot, packageName),
    ] as const);

    return Object.fromEntries(entries);
}

function createCacheVersion(options: BaseBundleBuildOptions): string {
    return [
        'base-bundle-metro',
        options.platform,
        options.dev ? 'dev' : 'prod',
        options.minify ? 'minify' : 'nominify',
    ].join(':');
}

function uniquePaths(paths: readonly string[]): readonly string[] {
    return [...new Set(paths)];
}
