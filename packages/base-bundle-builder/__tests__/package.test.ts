import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const packageJsonPath = join(import.meta.dir, '..', 'package.json');

describe('base-bundle-builder package manifest', () => {
    test('wires the base bundle build script and bin entry', () => {
        const packageJson = JSON.parse(readFileSync(packageJsonPath, 'utf8')) as {
            scripts?: Record<string, string>;
            bin?: Record<string, string>;
        };

        expect(packageJson.scripts?.['base-bundle:build']).toBe(
            'bun ./src/cli.ts base-bundle:build',
        );
        expect(packageJson.bin?.['onlook-base-bundle']).toBe('./src/cli.ts');
    });
});
