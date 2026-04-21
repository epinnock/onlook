import { describe, expect, test } from 'bun:test';

import {
    createInMemoryPureJsCache,
    mergePureJsArtifactIntoOverlay,
    resolvePureJsModule,
    type PureJsPackageArtifact,
} from '../src/pure-js-package';

function lodashArtifact(): PureJsPackageArtifact {
    return {
        packageName: 'lodash',
        version: '4.17.21',
        artifactHash: 'abc123',
        entry: 'index.js',
        modules: {
            'index.js':
                'module.exports = { pick: function(o, keys) { return keys.reduce(function(a, k){a[k]=o[k];return a;}, {}); } };',
            'fp.js': 'module.exports = { pick: require("./index.js").pick };',
        },
        subpaths: {
            fp: 'fp.js',
        },
    };
}

describe('pure-js-package / resolvePureJsModule', () => {
    test('resolves the exact packageName to the entry factory', () => {
        const artifact = lodashArtifact();
        const entry = resolvePureJsModule(artifact, 'lodash');
        expect(entry).toContain('module.exports');
    });

    test('resolves a mapped subpath via artifact.subpaths', () => {
        const artifact = lodashArtifact();
        const fp = resolvePureJsModule(artifact, 'lodash/fp');
        // The fp.js factory re-exports from index.js; assert that signature.
        expect(fp).toBe(artifact.modules['fp.js']);
    });

    test('resolves a raw deep path matching a module key', () => {
        const artifact = lodashArtifact();
        const fp = resolvePureJsModule(artifact, 'lodash/fp.js');
        expect(fp).toBe(artifact.modules['fp.js']);
    });

    test('returns null for a specifier that does not match the package', () => {
        const artifact = lodashArtifact();
        expect(resolvePureJsModule(artifact, 'zod')).toBeNull();
    });

    test('returns null for a subpath that neither subpaths nor modules cover', () => {
        const artifact = lodashArtifact();
        expect(resolvePureJsModule(artifact, 'lodash/missing/thing')).toBeNull();
    });
});

describe('pure-js-package / cache', () => {
    test('in-memory cache round-trips artifacts keyed by name+version', async () => {
        const cache = createInMemoryPureJsCache();
        const a = lodashArtifact();
        await cache.put(a);
        const got = await cache.get('lodash', '4.17.21');
        expect(got).toBe(a);
        expect(await cache.get('lodash', '3.0.0')).toBeNull();
    });
});

describe('pure-js-package / mergePureJsArtifactIntoOverlay', () => {
    test('allocates sequential module ids and returns entry id', () => {
        const overlay = { modules: {} as Record<number, string>, moduleIdCounter: 10 };
        const artifact = lodashArtifact();
        const { baseId, entryId } = mergePureJsArtifactIntoOverlay(overlay, artifact);
        expect(baseId).toBe(10);
        expect(overlay.moduleIdCounter).toBe(12); // lodash has 2 modules
        expect(overlay.modules[10]).toContain('module.exports');
        expect(overlay.modules[11]).toBe(artifact.modules['fp.js']);
        // entry id points at the index.js factory — whichever sequential id it got.
        expect([10, 11]).toContain(entryId);
        expect(overlay.modules[entryId]).toContain('module.exports');
    });
});
