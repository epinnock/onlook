import { afterEach, describe, expect, test } from 'bun:test';

const installExpoFileSystemShim = require('../../../../../../../packages/mobile-preview/runtime/shims/expo/expo-file-system.js');
const expoRuntimeShimCollection = require('../../../../../../../packages/mobile-preview/runtime/shims/expo/index.js');
const {
    applyRuntimeShims,
    getRegisteredRuntimeShimIds,
    registerRuntimeShim,
    resetRuntimeShimRegistry,
} = require('../../../../../../../packages/mobile-preview/runtime/registry.js');

const {
    LEGACY_MODULE_ID,
    MODULE_ID,
    RUNTIME_SHIM_REGISTRY_KEY,
} = installExpoFileSystemShim;

afterEach(() => {
    resetRuntimeShimRegistry();
});

type FsFile = {
    uri: string;
    create: () => FsFile;
    write: (contents: string) => void;
    textSync: () => string;
};

type FsDirectory = {
    create: () => FsDirectory;
};

type FileSystemModule = {
    default: FileSystemModule;
    __esModule: boolean;
    Paths: { bundle: string; cache: string; document: string };
    cacheDirectory: string;
    documentDirectory: string;
    Directory: new (base: string, name: string) => FsDirectory;
    File: new (parent: FsDirectory, name: string) => FsFile;
    writeAsStringAsync: (uri: string, contents: string) => Promise<undefined>;
    readDirectoryAsync: (uri: string) => Promise<string[]>;
    getInfoAsync: (
        uri: string,
    ) => Promise<{ exists: boolean; isDirectory: boolean; size: number; uri: string }>;
    readAsStringAsync: (uri: string) => Promise<string>;
    deleteAsync: (uri: string) => Promise<undefined>;
};

type LegacyFileSystemModule = {
    default: LegacyFileSystemModule;
    __esModule: boolean;
    readAsStringAsync: (uri: string) => Promise<string>;
    copyAsync: (options: { from: string; to: string }) => Promise<undefined>;
    moveAsync: (options: { from: string; to: string }) => Promise<undefined>;
    downloadAsync: (
        url: string,
        destination: string,
    ) => Promise<{ headers: Record<string, string>; md5: null; status: number; uri: string }>;
};

type ShimRegistry = {
    [MODULE_ID: string]: FileSystemModule | LegacyFileSystemModule | undefined;
};
type ShimTarget = { [key: string]: ShimRegistry };

describe('expo-file-system shim', () => {
    test('installs expo-file-system and expo-file-system/legacy into __onlookShims', async () => {
        const target: ShimTarget = {};

        const installed = installExpoFileSystemShim(target);
        const registry = target[RUNTIME_SHIM_REGISTRY_KEY] as ShimRegistry;
        const moduleExports = registry[MODULE_ID] as FileSystemModule;
        const legacyModuleExports = registry[LEGACY_MODULE_ID] as LegacyFileSystemModule;

        expect(installed.module).toBe(moduleExports);
        expect(installed.legacy).toBe(legacyModuleExports);
        expect(moduleExports.default).toBe(moduleExports);
        expect(legacyModuleExports.default).toBe(legacyModuleExports);
        expect(moduleExports.__esModule).toBe(true);
        expect(legacyModuleExports.__esModule).toBe(true);
        expect(moduleExports.Paths).toEqual({
            bundle: 'file:///onlook/bundle/',
            cache: 'file:///onlook/cache/',
            document: 'file:///onlook/document/',
        });

        const folder = new moduleExports.Directory(
            moduleExports.Paths.cache,
            'downloads',
        ).create();
        const file = new moduleExports.File(folder, 'note.txt').create();
        file.write('hello preview');

        expect(file.textSync()).toBe('hello preview');
        await expect(
            legacyModuleExports.readAsStringAsync(file.uri),
        ).resolves.toBe('hello preview');

        await expect(
            moduleExports.writeAsStringAsync(
                `${moduleExports.cacheDirectory}other.txt`,
                'from-legacy-api',
            ),
        ).resolves.toBeUndefined();
        await expect(
            moduleExports.readDirectoryAsync(moduleExports.cacheDirectory),
        ).resolves.toEqual(['downloads', 'other.txt']);
        await expect(
            moduleExports.getInfoAsync(`${moduleExports.cacheDirectory}other.txt`),
        ).resolves.toMatchObject({
            exists: true,
            isDirectory: false,
            size: 15,
            uri: 'file:///onlook/cache/other.txt',
        });

        await expect(
            legacyModuleExports.copyAsync({
                from: `${moduleExports.cacheDirectory}other.txt`,
                to: `${moduleExports.documentDirectory}copied.txt`,
            }),
        ).resolves.toBeUndefined();
        await expect(
            legacyModuleExports.moveAsync({
                from: `${moduleExports.documentDirectory}copied.txt`,
                to: `${moduleExports.documentDirectory}moved.txt`,
            }),
        ).resolves.toBeUndefined();
        await expect(
            legacyModuleExports.readAsStringAsync(
                `${moduleExports.documentDirectory}moved.txt`,
            ),
        ).resolves.toBe('from-legacy-api');

        await expect(
            legacyModuleExports.downloadAsync(
                'https://example.com/file.txt',
                `${moduleExports.cacheDirectory}download.txt`,
            ),
        ).resolves.toEqual({
            headers: {},
            md5: null,
            status: 200,
            uri: 'file:///onlook/cache/download.txt',
        });
        await expect(
            moduleExports.getInfoAsync(`${moduleExports.cacheDirectory}download.txt`),
        ).resolves.toMatchObject({
            exists: true,
            size: 0,
        });

        await expect(
            moduleExports.deleteAsync(`${moduleExports.cacheDirectory}other.txt`),
        ).resolves.toBeUndefined();
        await expect(
            moduleExports.readAsStringAsync(`${moduleExports.cacheDirectory}other.txt`),
        ).resolves.toBe('');
    });

    test('merges into existing expo-file-system and legacy registry entries', () => {
        const existingReadAsStringAsync = async () => 'existing-read';
        const existingWriteAsStringAsync = async () => undefined;
        const target = {
            __onlookShims: {
                'expo-file-system': {
                    default: 'keep-default',
                    readAsStringAsync: existingReadAsStringAsync,
                },
                'expo-file-system/legacy': {
                    default: 'keep-legacy-default',
                    writeAsStringAsync: existingWriteAsStringAsync,
                },
            },
        };

        const installed = installExpoFileSystemShim(target);

        expect(installed.module).toBe(target.__onlookShims['expo-file-system']);
        expect(installed.legacy).toBe(target.__onlookShims['expo-file-system/legacy']);
        expect(installed.module.readAsStringAsync).toBe(existingReadAsStringAsync);
        expect(installed.module.downloadAsync).toBeFunction();
        expect(installed.module.Paths.cache).toBe('file:///onlook/cache/');
        expect(installed.module.default).toBe('keep-default');
        expect(installed.module.__esModule).toBe(true);
        expect(installed.legacy.writeAsStringAsync).toBe(existingWriteAsStringAsync);
        expect(installed.legacy.deleteAsync).toBeFunction();
        expect(installed.legacy.default).toBe('keep-legacy-default');
        expect(installed.legacy.__esModule).toBe(true);
    });

    test('auto-discovers the expo-file-system shim id from the expo collection', () => {
        registerRuntimeShim(
            installExpoFileSystemShim,
            './shims/expo/expo-file-system.js',
        );
        registerRuntimeShim(expoRuntimeShimCollection, './shims/expo/index.js');

        const target: { __onlookShims: Record<string, unknown> } = {
            __onlookShims: {},
        };

        applyRuntimeShims(target);

        expect(getRegisteredRuntimeShimIds()).toEqual(['expo-file-system']);
        expect(target.__onlookShims[MODULE_ID]).toBeDefined();
        expect(target.__onlookShims[LEGACY_MODULE_ID]).toBeDefined();
    });
});
