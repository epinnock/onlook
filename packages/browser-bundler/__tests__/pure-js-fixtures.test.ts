import { describe, expect, test } from 'bun:test';

import {
    createInMemoryPureJsCache,
    mergePureJsArtifactIntoOverlay,
    resolvePureJsModule,
} from '../src/pure-js-package';
import {
    lodashFixtureArtifact,
    zodFixtureArtifact,
} from './fixtures/pure-js-artifacts';

describe('pure-js fixtures — lodash + zod composition', () => {
    test('lodash fixture resolves entry, subpath, and deep path', () => {
        const artifact = lodashFixtureArtifact();
        expect(resolvePureJsModule(artifact, 'lodash')).toContain('require("./_base")');
        expect(resolvePureJsModule(artifact, 'lodash/fp')).toContain('pick: base.pick');
        expect(resolvePureJsModule(artifact, 'lodash/_base.js')).toContain('pick: function');
    });

    test('zod fixture resolves entry to the z.* factories', () => {
        const artifact = zodFixtureArtifact();
        const entry = resolvePureJsModule(artifact, 'zod');
        expect(entry).toContain('object:');
        expect(entry).toContain('string:');
    });

    test('both artifacts merge into an overlay without id collisions', () => {
        const overlay = { modules: {} as Record<number, string>, moduleIdCounter: 0 };
        mergePureJsArtifactIntoOverlay(overlay, lodashFixtureArtifact()); // 3 modules
        mergePureJsArtifactIntoOverlay(overlay, zodFixtureArtifact()); // 1 module
        expect(overlay.moduleIdCounter).toBe(4);
        const ids = Object.keys(overlay.modules).map(Number);
        expect(new Set(ids).size).toBe(ids.length); // unique
    });

    test('cache round-trips both fixtures keyed by name+version', async () => {
        const cache = createInMemoryPureJsCache();
        const lodash = lodashFixtureArtifact();
        const zod = zodFixtureArtifact();
        await cache.put(lodash);
        await cache.put(zod);
        expect(await cache.get('lodash', '4.17.21')).toBe(lodash);
        expect(await cache.get('zod', '3.23.0')).toBe(zod);
        expect(await cache.get('lodash', '3.0.0')).toBeNull();
    });

    test('module factories are syntactically runnable as CJS', () => {
        const lodash = lodashFixtureArtifact();
        // Evaluate _base.js in a fresh CJS scope. If the factory has a syntax
        // error, this throws — the test's value is proving the fixture is
        // actually executable (not just a string stored somewhere).
        const module = { exports: {} as Record<string, unknown> };
        const factory = new Function('module', 'exports', 'require', lodash.modules['_base.js']!);
        factory(module, module.exports, () => undefined);
        const base = module.exports as {
            pick?: (o: Record<string, unknown>, keys: string[]) => Record<string, unknown>;
        };
        expect(typeof base.pick).toBe('function');
        expect(base.pick?.({ a: 1, b: 2, c: 3 }, ['a', 'c'])).toEqual({ a: 1, c: 3 });
    });
});
