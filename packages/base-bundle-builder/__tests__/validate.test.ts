import { describe, expect, test } from 'bun:test';

import { createBaseBundleBuildOptions } from '../src/options';
import { createBaseBundleArtifactMetadata } from '../src/artifact';
import {
    assertValidBaseBundleArtifact,
    validateBaseBundleArtifact,
} from '../src/validate';

function createValidArtifact() {
    const code = 'console.log("artifact");\n';
    const map = '{"version":3,"sources":[],"mappings":""}';

    return {
        code,
        map,
        metadata: createBaseBundleArtifactMetadata({
            code,
            map,
            options: createBaseBundleBuildOptions({
                projectRoot: '/repo/app',
                outputDir: '/repo/dist',
                platform: 'ios',
                dev: false,
                minify: true,
            }),
            createdAt: new Date('2026-04-20T12:34:56.789Z'),
        }),
    };
}

describe('validateBaseBundleArtifact', () => {
    test('accepts a valid artifact', () => {
        const artifact = createValidArtifact();

        const result = validateBaseBundleArtifact(artifact);

        expect(result.valid).toBe(true);
        expect(result.issues).toEqual([]);
        expect(() => assertValidBaseBundleArtifact(artifact)).not.toThrow();
    });

    test('reports a hash mismatch', () => {
        const artifact = createValidArtifact();
        const result = validateBaseBundleArtifact({
            ...artifact,
            metadata: {
                ...artifact.metadata,
                hash: '0'.repeat(64),
            },
        });

        expect(result.valid).toBe(false);
        expect(result.issues).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    field: 'metadata.hash',
                    message: 'Base bundle artifact hash must match the artifact code',
                }),
            ]),
        );
    });

    test('reports empty code', () => {
        const artifact = createValidArtifact();
        const result = validateBaseBundleArtifact({
            ...artifact,
            code: '   ',
        });

        expect(result.valid).toBe(false);
        expect(result.issues).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    field: 'code',
                    message: 'Base bundle artifact code must be non-empty',
                }),
            ]),
        );
    });

    test('reports byte mismatches', () => {
        const artifact = createValidArtifact();
        const result = validateBaseBundleArtifact({
            ...artifact,
            metadata: {
                ...artifact.metadata,
                mapBytes: artifact.metadata.mapBytes + 1,
            },
        });

        expect(result.valid).toBe(false);
        expect(result.issues).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    field: 'metadata.mapBytes',
                    message: 'Base bundle artifact mapBytes must match the map byte length',
                }),
            ]),
        );
    });
});
