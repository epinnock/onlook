import { describe, expect, test } from 'bun:test';

import {
    createAssetRegistry,
    installAssetRegistry,
    seedAssetRegistry,
    toMetroAssetRegistryEntry,
    type AssetRegistryGlobals,
    type MetroAssetRegistryEntry,
} from '../asset-registry-shim';

describe('toMetroAssetRegistryEntry', () => {
    test('parses R2 URI to derive name/type/location', () => {
        const entry = toMetroAssetRegistryEntry({
            hash: 'abc123',
            uri: 'https://r2/assets/images/icon.png',
            mime: 'image/png',
            width: 24,
            height: 24,
        });
        expect(entry).toEqual({
            httpServerLocation: '/assets/images',
            width: 24,
            height: 24,
            scales: [1],
            hash: 'abc123',
            name: 'icon',
            type: 'png',
        });
    });

    test('honors explicit scales override', () => {
        const entry = toMetroAssetRegistryEntry({
            hash: 'h',
            uri: 'https://r2/logo.png',
            mime: 'image/png',
            scales: [1, 2, 3],
        });
        expect(entry.scales).toEqual([1, 2, 3]);
    });

    test('falls back to mime subtype when URI has no extension', () => {
        const entry = toMetroAssetRegistryEntry({
            hash: 'h',
            uri: 'https://r2/opaque',
            mime: 'image/webp',
        });
        expect(entry.type).toBe('webp');
        expect(entry.name).toBe('opaque');
    });

    test('handles malformed URI with sensible defaults', () => {
        const entry = toMetroAssetRegistryEntry({
            hash: 'h',
            uri: 'not-a-uri',
            mime: 'image/png',
        });
        expect(entry.name).toBe('asset');
        expect(entry.type).toBe('png');
        expect(entry.httpServerLocation).toBe('/');
    });

    test('strips +suffix from mime subtype (svg+xml → svg)', () => {
        const entry = toMetroAssetRegistryEntry({
            hash: 'h',
            uri: 'https://r2/opaque',
            mime: 'image/svg+xml',
        });
        expect(entry.type).toBe('svg');
    });

    test('omits width/height when not provided', () => {
        const entry = toMetroAssetRegistryEntry({
            hash: 'h',
            uri: 'https://r2/font.ttf',
            mime: 'font/ttf',
        });
        expect(entry.width).toBeUndefined();
        expect(entry.height).toBeUndefined();
        expect(entry.type).toBe('ttf');
    });
});

// ─── Registry installation (task #67) ────────────────────────────────────────

function asEntry(name: string): MetroAssetRegistryEntry {
    return {
        httpServerLocation: '/assets',
        scales: [1],
        hash: 'h-' + name,
        name,
        type: 'png',
    };
}

describe('createAssetRegistry', () => {
    test('starts empty', () => {
        const r = createAssetRegistry();
        expect(r.size).toBe(0);
        expect(r.getAssetByID(1)).toBeUndefined();
    });

    test('registerAsset returns 1-based ids in insertion order (Metro convention)', () => {
        const r = createAssetRegistry();
        expect(r.registerAsset(asEntry('a'))).toBe(1);
        expect(r.registerAsset(asEntry('b'))).toBe(2);
        expect(r.registerAsset(asEntry('c'))).toBe(3);
        expect(r.size).toBe(3);
    });

    test('getAssetByID returns the asset registered at that id', () => {
        const r = createAssetRegistry();
        const idA = r.registerAsset(asEntry('a'));
        const idB = r.registerAsset(asEntry('b'));
        expect(r.getAssetByID(idA)?.name).toBe('a');
        expect(r.getAssetByID(idB)?.name).toBe('b');
    });

    test('getAssetByID returns undefined for out-of-range ids', () => {
        const r = createAssetRegistry();
        r.registerAsset(asEntry('only'));
        expect(r.getAssetByID(0)).toBeUndefined(); // Metro is 1-based
        expect(r.getAssetByID(2)).toBeUndefined();
        expect(r.getAssetByID(-1)).toBeUndefined();
    });

    test('size grows with each registerAsset call', () => {
        const r = createAssetRegistry();
        expect(r.size).toBe(0);
        r.registerAsset(asEntry('x'));
        expect(r.size).toBe(1);
    });
});

describe('seedAssetRegistry', () => {
    test('pre-populates the registry from an entries map and returns id mapping', () => {
        const seeded = seedAssetRegistry({
            entries: {
                'image/abc': asEntry('a'),
                'image/def': asEntry('b'),
            },
        });
        expect(seeded.registry.size).toBe(2);
        expect(seeded.idByAssetId['image/abc']).toBe(1);
        expect(seeded.idByAssetId['image/def']).toBe(2);
        expect(seeded.registry.getAssetByID(1)?.name).toBe('a');
        expect(seeded.registry.getAssetByID(2)?.name).toBe('b');
    });

    test('preserves insertion order across builds with the same manifest', () => {
        // Reproducible Metro ids depend on stable insertion order. JS object
        // iteration honors insertion order for string keys, so two seeded
        // registries with identical inputs assign identical ids.
        const entries = {
            'image/a': asEntry('a'),
            'image/b': asEntry('b'),
            'image/c': asEntry('c'),
        };
        const seedA = seedAssetRegistry({ entries });
        const seedB = seedAssetRegistry({ entries });
        expect(seedA.idByAssetId).toEqual(seedB.idByAssetId);
    });

    test('empty input yields an empty registry + empty mapping', () => {
        const seeded = seedAssetRegistry({ entries: {} });
        expect(seeded.registry.size).toBe(0);
        expect(seeded.idByAssetId).toEqual({});
    });
});

describe('installAssetRegistry', () => {
    test('writes the registry to globals.__onlookAssetRegistry', () => {
        const globals: AssetRegistryGlobals = {};
        const r = createAssetRegistry();
        installAssetRegistry(globals, r);
        expect(globals.__onlookAssetRegistry).toBe(r);
    });

    test('re-installing replaces the previous registry (overlay re-mount semantics)', () => {
        const globals: AssetRegistryGlobals = {};
        const r1 = createAssetRegistry();
        const r2 = createAssetRegistry();
        installAssetRegistry(globals, r1);
        installAssetRegistry(globals, r2);
        expect(globals.__onlookAssetRegistry).toBe(r2);
        expect(globals.__onlookAssetRegistry).not.toBe(r1);
    });
});
