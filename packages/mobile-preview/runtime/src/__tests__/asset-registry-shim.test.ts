import { describe, expect, test } from 'bun:test';

import { toMetroAssetRegistryEntry } from '../asset-registry-shim';

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
