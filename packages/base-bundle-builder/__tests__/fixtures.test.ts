import { describe, expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const fixturesRoot = join(import.meta.dir, '..', 'fixtures');

const fixtures = [
    {
        name: 'hello',
        expectedDependencies: ['expo', 'react', 'react-native'],
        forbiddenDependencies: ['@react-navigation/native', '@expo/vector-icons'],
    },
    {
        name: 'tabs-template',
        expectedDependencies: [
            'expo',
            'expo-status-bar',
            'react',
            'react-native',
            'react-native-safe-area-context',
        ],
        forbiddenDependencies: [
            '@expo/vector-icons',
            '@react-navigation/bottom-tabs',
            '@react-navigation/native',
            'expo-font',
            'react-dom',
            'react-native-screens',
            'react-native-web',
        ],
    },
] as const;

describe('base-bundle-builder fixtures', () => {
    test('all canonical fixtures are present', () => {
        const fixtureNames = readdirSync(fixturesRoot).sort();

        expect(fixtureNames).toContain('hello');
        expect(fixtureNames).toContain('tabs-template');
    });

    for (const fixture of fixtures) {
        test(`${fixture.name} has the expected Expo project shape`, () => {
            const root = join(fixturesRoot, fixture.name);
            const packageJson = readJson<FixturePackageJson>(join(root, 'package.json'));
            const appJson = readJson<Record<string, unknown>>(join(root, 'app.json'));
            const tsconfig = readJson<Record<string, unknown>>(join(root, 'tsconfig.json'));

            expect(packageJson.private).toBe(true);
            expect(packageJson.main).toBe('index.ts');
            expect(appJson).toHaveProperty('expo');
            expect(tsconfig).toHaveProperty('compilerOptions');
            expect(existsSync(join(root, 'index.ts'))).toBe(true);
            expect(existsSync(join(root, 'App.tsx'))).toBe(true);

            for (const dependency of fixture.expectedDependencies) {
                expect(packageJson.dependencies).toHaveProperty(dependency);
            }

            for (const dependency of fixture.forbiddenDependencies) {
                expect(packageJson.dependencies ?? {}).not.toHaveProperty(dependency);
                expect(packageJson.devDependencies ?? {}).not.toHaveProperty(dependency);
            }
        });
    }
});

interface FixturePackageJson {
    private: boolean;
    main: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
}

function readJson<T>(filePath: string): T {
    return JSON.parse(readFileSync(filePath, 'utf8')) as T;
}

