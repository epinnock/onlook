import { describe, expect, test } from 'bun:test';

import { assertBaseBundlesEnv, type Env } from '../env';

function makeEnv(overrides: Partial<Env> = {}): Env {
    return {
        BUNDLES: {} as KVNamespace,
        EXPO_SESSION: {} as Env['EXPO_SESSION'],
        ESM_CACHE_URL: 'https://cf-esm-cache.dev.workers.dev',
        ...overrides,
    };
}

describe('env helpers', () => {
    test('assertBaseBundlesEnv throws when the BASE_BUNDLES binding is missing', () => {
        const env = makeEnv();

        expect(() => assertBaseBundlesEnv(env, '/base-bundle')).toThrow(
            'expo-relay: missing BASE_BUNDLES binding for /base-bundle',
        );
    });

    test('assertBaseBundlesEnv accepts a concrete base-bundle env', () => {
        const env = makeEnv({
            BASE_BUNDLES: {} as R2Bucket,
        });

        expect(() => assertBaseBundlesEnv(env, '/base-bundles')).not.toThrow();
        expect(env.BASE_BUNDLES).toBeDefined();
    });
});
