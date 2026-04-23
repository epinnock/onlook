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

// ─── Representative-package coverage (task #52) ─────────────────────────────
// Phase 6 acceptance requires fixture coverage for lodash (CJS, deep), zod
// (CJS w/ subpath), nanoid (ESM-friendly, small), an ESM-only specimen, and
// explicit subpath variation. The other resolvers remain a runtime concern;
// these tests just lock in the artifact format's ability to represent each
// shape so the pure-js builder's output conventions stay stable.

function zodArtifact(): PureJsPackageArtifact {
    return {
        packageName: 'zod',
        version: '3.22.4',
        artifactHash: 'zodhash1',
        entry: 'lib/index.js',
        modules: {
            'lib/index.js':
                'module.exports = { z: { string: function(){return {parse: function(x){return x;}};}, number: function(){return {parse: function(x){return x;}};} } };',
            'lib/types/string.js':
                'module.exports = function(){ return { parse: function(x){ return x; } }; };',
            'lib/types/number.js':
                'module.exports = function(){ return { parse: function(x){ return x; } }; };',
        },
        subpaths: {
            'types/string': 'lib/types/string.js',
            'types/number': 'lib/types/number.js',
        },
    };
}

function nanoidArtifact(): PureJsPackageArtifact {
    return {
        packageName: 'nanoid',
        version: '5.0.6',
        artifactHash: 'nanoidhash1',
        entry: 'index.js',
        modules: {
            'index.js':
                'module.exports = { nanoid: function(n){ return "x".repeat(n || 21); } };',
        },
        subpaths: {},
    };
}

function esmOnlySpecimen(): PureJsPackageArtifact {
    // ESM-only packages get transpiled to CJS at artifact-build time — the
    // runtime module table is CJS. This fixture represents what the browser
    // bundler emits after transpile: module.exports with a default + named
    // export shape mirroring import {foo} from 'pkg' / import pkg from 'pkg'.
    return {
        packageName: 'esm-only-pkg',
        version: '1.0.0',
        artifactHash: 'esmhash1',
        entry: 'index.js',
        modules: {
            'index.js':
                'Object.defineProperty(module.exports, "__esModule", { value: true }); module.exports.default = { greet: function(){ return "hi"; } }; module.exports.named = function(){ return 42; };',
        },
        subpaths: {},
    };
}

describe('pure-js-package / representative package shapes (task #52)', () => {
    test('zod: resolves main entry via packageName', () => {
        const artifact = zodArtifact();
        const entry = resolvePureJsModule(artifact, 'zod');
        expect(entry).toContain('z: {');
    });

    test('zod: resolves a deep typed subpath via artifact.subpaths', () => {
        const artifact = zodArtifact();
        const stringT = resolvePureJsModule(artifact, 'zod/types/string');
        expect(stringT).toBe(artifact.modules['lib/types/string.js']);
        const numberT = resolvePureJsModule(artifact, 'zod/types/number');
        expect(numberT).toBe(artifact.modules['lib/types/number.js']);
    });

    test('zod: merging allocates a contiguous id block — size matches modules count', () => {
        const overlay = { modules: {} as Record<number, string>, moduleIdCounter: 100 };
        const artifact = zodArtifact();
        const { baseId, entryId } = mergePureJsArtifactIntoOverlay(overlay, artifact);
        expect(baseId).toBe(100);
        expect(overlay.moduleIdCounter).toBe(103); // zod has 3 modules
        expect(Object.keys(overlay.modules)).toHaveLength(3);
        expect(overlay.modules[entryId]).toContain('z: {');
    });

    test('nanoid: single-module package merges as one id', () => {
        const overlay = { modules: {} as Record<number, string>, moduleIdCounter: 50 };
        const artifact = nanoidArtifact();
        const { baseId, entryId } = mergePureJsArtifactIntoOverlay(overlay, artifact);
        expect(baseId).toBe(50);
        expect(entryId).toBe(50);
        expect(overlay.moduleIdCounter).toBe(51);
        expect(overlay.modules[50]).toContain('nanoid:');
    });

    test('ESM-only specimen: __esModule flag + default + named both present in factory source', () => {
        // The factory body itself is the artifact value — runtime wires it
        // via CJS `module.exports` conventions. The interop contract is
        // captured by these two markers.
        const artifact = esmOnlySpecimen();
        const factory = resolvePureJsModule(artifact, 'esm-only-pkg');
        expect(factory).toContain('__esModule');
        expect(factory).toContain('module.exports.default');
        expect(factory).toContain('module.exports.named');
    });

    test('cache survives a round-trip of three different-package shapes', async () => {
        const cache = createInMemoryPureJsCache();
        const shapes = [lodashArtifact(), zodArtifact(), nanoidArtifact()];
        for (const s of shapes) {
            await cache.put(s);
        }
        for (const s of shapes) {
            const got = await cache.get(s.packageName, s.version);
            expect(got).toBe(s);
        }
    });

    test('subpath fallback priority: exact subpaths map wins over raw module key', () => {
        // If both `subpaths['fp']` AND a `fp.js` module key exist, the
        // subpaths map should win for the bare `pkg/fp` specifier — the
        // package author's intent-mapped subpath is authoritative.
        const artifact = lodashArtifact();
        const viaSubpath = resolvePureJsModule(artifact, 'lodash/fp');
        const viaRaw = resolvePureJsModule(artifact, 'lodash/fp.js');
        expect(viaSubpath).toBe(artifact.modules['fp.js']);
        expect(viaRaw).toBe(artifact.modules['fp.js']);
        // In this fixture both resolve to the same target; the test guards
        // against a regression where one of the paths returned null or a
        // different factory.
        expect(viaSubpath).toBe(viaRaw);
    });
});
