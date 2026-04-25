import { describe, expect, test } from 'bun:test';

import { buildBaseBundle, type BaseBundleMetroBuildRequest } from '../src/build';
import { SYNTHETIC_BASE_BUNDLE_ENTRY_MARKER } from '../src/entry';

describe('buildBaseBundle', () => {
    test('normalizes options and invokes the injected Metro runner', async () => {
        let captured: BaseBundleMetroBuildRequest | undefined;

        const result = await buildBaseBundle({
            cwd: '/repo',
            projectRoot: 'fixtures/hello',
            outputDir: 'dist/base',
            platform: 'android',
            runMetroBuild(request) {
                captured = request;
                return {
                    code: 'console.log("base");',
                    map: '{}',
                    modules: [{ id: 1 }],
                };
            },
        });

        expect(captured?.options.projectRoot).toBe('/repo/fixtures/hello');
        expect(captured?.options.outputDir).toBe('/repo/dist/base');
        expect(captured?.metroConfig.platform).toBe('android');
        expect(captured?.entrySource).toContain(SYNTHETIC_BASE_BUNDLE_ENTRY_MARKER);
        expect(result.code).toBe('console.log("base");');
        expect(result.modules).toEqual([{ id: 1 }]);
    });

    test('rejects empty Metro output', async () => {
        await expect(
            buildBaseBundle({
                cwd: '/repo',
                projectRoot: 'fixtures/hello',
                outputDir: 'dist/base',
                runMetroBuild() {
                    return { code: ' ' };
                },
            }),
        ).rejects.toThrow('empty code');
    });

    test('emits aliasEmitterOutput when modules expose specifier+id pairs — task #9', async () => {
        const result = await buildBaseBundle({
            cwd: '/repo',
            projectRoot: 'fixtures/hello',
            outputDir: 'dist/base',
            runMetroBuild() {
                return {
                    code: 'console.log("base");',
                    modules: [
                        { id: 10, specifier: 'react' },
                        { id: 11, specifier: 'react-native' },
                        { id: 12, specifier: 'expo-status-bar' },
                    ],
                };
            },
        });
        expect(result.aliasEmitterOutput).toBeDefined();
        expect(result.aliasEmitterOutput?.sidecar.aliases).toEqual({
            'expo-status-bar': 12,
            react: 10,
            'react-native': 11,
        });
        // sidecarJson round-trips.
        expect(JSON.parse(result.aliasEmitterOutput!.sidecarJson)).toEqual({
            aliases: {
                'expo-status-bar': 12,
                react: 10,
                'react-native': 11,
            },
            specifiers: ['expo-status-bar', 'react', 'react-native'],
        });
    });

    test('aliasEmitterOutput is undefined when the runner reports no modules — task #9', async () => {
        const result = await buildBaseBundle({
            cwd: '/repo',
            projectRoot: 'fixtures/hello',
            outputDir: 'dist/base',
            runMetroBuild() {
                return { code: 'console.log("x");' };
            },
        });
        expect(result.aliasEmitterOutput).toBeUndefined();
    });
});
