import { describe, expect, it } from 'bun:test';
import {
    getSnackDeps,
    mergeDeps,
    parsePackageJsonDeps,
    removeSnackDep,
    updateSnackDeps,
    type SnackDep,
    type SnackInstance,
} from '../dependencies';

// ---------------------------------------------------------------------------
// Helpers – lightweight mock for SnackInstance
// ---------------------------------------------------------------------------

function createMockSnack(initial: Record<string, SnackDep> = {}): SnackInstance {
    let deps = { ...initial };
    return {
        updateDependencies(update: Record<string, SnackDep | null>) {
            for (const [name, value] of Object.entries(update)) {
                if (value === null) {
                    delete deps[name];
                } else {
                    deps[name] = value;
                }
            }
        },
        getState() {
            return { dependencies: { ...deps } };
        },
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('parsePackageJsonDeps', () => {
    it('parses dependencies from a valid package.json string', () => {
        const json = JSON.stringify({
            name: 'my-app',
            dependencies: {
                react: '18.2.0',
                'react-native': '0.73.0',
            },
        });

        const result = parsePackageJsonDeps(json);

        expect(result).toEqual({
            react: { version: '18.2.0' },
            'react-native': { version: '0.73.0' },
        });
    });

    it('merges dependencies and devDependencies', () => {
        const json = JSON.stringify({
            dependencies: { lodash: '4.17.21' },
            devDependencies: { typescript: '5.5.4' },
        });

        const result = parsePackageJsonDeps(json);

        expect(result).toEqual({
            lodash: { version: '4.17.21' },
            typescript: { version: '5.5.4' },
        });
    });

    it('returns an empty record for invalid JSON', () => {
        expect(parsePackageJsonDeps('not json')).toEqual({});
    });

    it('ignores non-string version values', () => {
        const json = JSON.stringify({
            dependencies: {
                valid: '^1.0.0',
                invalid: 42,
                alsoInvalid: null,
            },
        });

        const result = parsePackageJsonDeps(json);
        expect(result).toEqual({ valid: { version: '^1.0.0' } });
    });
});

describe('updateSnackDeps', () => {
    it('adds new dependencies to a snack instance', () => {
        const snack = createMockSnack();

        updateSnackDeps(snack, { expo: '51.0.0', 'expo-router': '3.0.0' });

        const state = snack.getState();
        expect(state.dependencies).toEqual({
            expo: { version: '51.0.0' },
            'expo-router': { version: '3.0.0' },
        });
    });
});

describe('removeSnackDep', () => {
    it('removes an existing dependency from a snack instance', () => {
        const snack = createMockSnack({
            react: { version: '18.2.0' },
            lodash: { version: '4.17.21' },
        });

        removeSnackDep(snack, 'lodash');

        const state = snack.getState();
        expect(state.dependencies).toEqual({
            react: { version: '18.2.0' },
        });
    });
});

describe('getSnackDeps', () => {
    it('converts SnackDep records to a simple name-version map', () => {
        const state = {
            dependencies: {
                react: { version: '18.2.0' },
                'react-native': { version: '0.73.0' },
            },
        };

        expect(getSnackDeps(state)).toEqual({
            react: '18.2.0',
            'react-native': '0.73.0',
        });
    });

    it('returns an empty record when there are no dependencies', () => {
        expect(getSnackDeps({ dependencies: {} })).toEqual({});
    });
});

describe('mergeDeps', () => {
    it('merges incoming deps into existing, overwriting conflicts', () => {
        const existing: Record<string, SnackDep> = {
            react: { version: '18.2.0' },
            lodash: { version: '4.17.21' },
        };

        const result = mergeDeps(existing, {
            react: '19.0.0',
            expo: '51.0.0',
        });

        expect(result).toEqual({
            react: { version: '19.0.0' },
            lodash: { version: '4.17.21' },
            expo: { version: '51.0.0' },
        });
    });

    it('does not mutate the original existing record', () => {
        const existing: Record<string, SnackDep> = {
            react: { version: '18.2.0' },
        };

        mergeDeps(existing, { react: '19.0.0' });

        expect(existing.react.version).toBe('18.2.0');
    });
});
