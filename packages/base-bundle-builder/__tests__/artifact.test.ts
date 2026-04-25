import { describe, expect, test } from 'bun:test';

import { createBaseBundleBuildOptions } from '../src/options';
import {
    createBaseBundleArtifactMetadata,
    hashBaseBundleCode,
} from '../src/artifact';

describe('base bundle artifact metadata', () => {
    test('hashes bundle code deterministically', () => {
        const code = 'console.log("bundle");\n';

        expect(hashBaseBundleCode(code)).toBe(hashBaseBundleCode(code));
        expect(hashBaseBundleCode(code)).toHaveLength(64);
        expect(hashBaseBundleCode(code)).toMatch(/^[0-9a-f]{64}$/);
        expect(hashBaseBundleCode(code)).not.toBe(
            hashBaseBundleCode('console.log("bundle v2");\n'),
        );
    });

    test('records byte counts from the build output', () => {
        const metadata = createBaseBundleArtifactMetadata({
            code: 'console.log("π");\n',
            map: '{"version":3,"mappings":""}',
            options: createBaseBundleBuildOptions({
                projectRoot: '/repo/app',
                outputDir: '/repo/dist',
                platform: 'android',
                dev: true,
                minify: false,
            }),
            createdAt: new Date('2026-04-20T12:34:56.789Z'),
        });

        expect(metadata).toMatchObject({
            hash: hashBaseBundleCode('console.log("π");\n'),
            codeBytes: new TextEncoder().encode('console.log("π");\n').byteLength,
            mapBytes: new TextEncoder().encode('{"version":3,"mappings":""}').byteLength,
            createdAt: '2026-04-20T12:34:56.789Z',
            platform: 'android',
            dev: true,
            minify: false,
        });
    });

    test('injects a stable createdAt timestamp when provided', () => {
        const createdAt = new Date('2026-01-02T03:04:05.006Z');
        const metadata = createBaseBundleArtifactMetadata({
            code: 'export default 1;\n',
            options: createBaseBundleBuildOptions({
                projectRoot: '/repo/app',
                outputDir: '/repo/dist',
            }),
            createdAt,
        });

        expect(metadata.createdAt).toBe('2026-01-02T03:04:05.006Z');
    });
});
