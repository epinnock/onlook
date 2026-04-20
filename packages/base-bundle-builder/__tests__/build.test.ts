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
});
