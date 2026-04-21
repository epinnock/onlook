/**
 * Tests for the base manifest emitter — ADR-0001 / two-tier-overlay-v2 task #10.
 *
 * Pins:
 *   - round-trip through `BaseManifestSchema.parse`
 *   - hash determinism (bundleHash + aliasHash)
 *   - `aliases` defaults to `listConcreteCapabilitySpecifiers()`
 *   - ABI version literal
 *   - disk write produces schema-valid JSON
 *   - schema rejects malformed manifests (platform/bundleUrl)
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, test } from 'bun:test';

import { BaseManifestSchema } from '@onlook/mobile-client-protocol';

import { emitBaseManifest, writeBaseManifest } from '../src/base-manifest';
import { listConcreteCapabilitySpecifiers } from '../src/runtime-capabilities';

const BASE_INPUT = {
    bundleBytes: new TextEncoder().encode('var __r=function(){};//base-bundle v1\n'),
    aliasSidecarJson: JSON.stringify({
        aliases: { react: 0, 'react-native': 1 },
        specifiers: ['react', 'react-native'],
    }),
    rnVersion: '0.81.6',
    expoSdk: '54.0.0',
    reactVersion: '18.3.1',
    platform: 'ios' as const,
    bundleUrl: 'https://cdn.onlook.test/base/v1/bundle.ios.js',
} as const;

describe('emitBaseManifest', () => {
    test('produces a BaseManifest that parses cleanly through BaseManifestSchema', () => {
        const manifest = emitBaseManifest(BASE_INPUT);
        expect(() => BaseManifestSchema.parse(manifest)).not.toThrow();
    });

    test('round-trips every required + optional field when all URLs are provided', () => {
        const manifest = emitBaseManifest({
            ...BASE_INPUT,
            aliasMapUrl: 'https://cdn.onlook.test/base/v1/alias-map.json',
            sourceMapUrl: 'https://cdn.onlook.test/base/v1/bundle.ios.js.map',
        });
        const parsed = BaseManifestSchema.parse(manifest);
        expect(parsed.abi).toBe('v1');
        expect(parsed.aliasMapUrl).toBe('https://cdn.onlook.test/base/v1/alias-map.json');
        expect(parsed.sourceMapUrl).toBe('https://cdn.onlook.test/base/v1/bundle.ios.js.map');
        expect(parsed.rnVersion).toBe('0.81.6');
        expect(parsed.expoSdk).toBe('54.0.0');
        expect(parsed.reactVersion).toBe('18.3.1');
        expect(parsed.platform).toBe('ios');
    });

    test('bundleHash and aliasHash are stable across calls with the same input', () => {
        const a = emitBaseManifest(BASE_INPUT);
        const b = emitBaseManifest(BASE_INPUT);
        expect(a.bundleHash).toBe(b.bundleHash);
        expect(a.aliasHash).toBe(b.aliasHash);
        expect(a.bundleHash).toMatch(/^[0-9a-f]{64}$/);
        expect(a.aliasHash).toMatch(/^[0-9a-f]{64}$/);
    });

    test('different bundleBytes yield different bundleHash', () => {
        const a = emitBaseManifest(BASE_INPUT);
        const b = emitBaseManifest({
            ...BASE_INPUT,
            bundleBytes: new TextEncoder().encode('var __r=function(){};//base-bundle v2\n'),
        });
        expect(a.bundleHash).not.toBe(b.bundleHash);
        // aliasSidecarJson was unchanged — aliasHash should be stable across variants.
        expect(a.aliasHash).toBe(b.aliasHash);
    });

    test('different aliasSidecarJson yields different aliasHash', () => {
        const a = emitBaseManifest(BASE_INPUT);
        const b = emitBaseManifest({
            ...BASE_INPUT,
            aliasSidecarJson: JSON.stringify({
                aliases: { react: 0, 'react-native': 1, 'expo-status-bar': 2 },
                specifiers: ['expo-status-bar', 'react', 'react-native'],
            }),
        });
        expect(a.aliasHash).not.toBe(b.aliasHash);
        expect(a.bundleHash).toBe(b.bundleHash);
    });

    test('aliases defaults to listConcreteCapabilitySpecifiers() when not provided', () => {
        const manifest = emitBaseManifest(BASE_INPUT);
        expect(manifest.aliases).toEqual(listConcreteCapabilitySpecifiers());
    });

    test('honors a caller-supplied concreteAliases list', () => {
        const manifest = emitBaseManifest({
            ...BASE_INPUT,
            concreteAliases: ['react', 'react-native', 'my-custom-specifier'],
        });
        expect(manifest.aliases).toEqual(['react', 'react-native', 'my-custom-specifier']);
    });

    test('abi is always the literal "v1"', () => {
        expect(emitBaseManifest(BASE_INPUT).abi).toBe('v1');
        expect(
            emitBaseManifest({ ...BASE_INPUT, platform: 'android' }).abi,
        ).toBe('v1');
    });

    test('optional URL fields are omitted (not set to undefined) when not provided', () => {
        const manifest = emitBaseManifest(BASE_INPUT);
        expect('aliasMapUrl' in manifest).toBe(false);
        expect('sourceMapUrl' in manifest).toBe(false);
    });
});

describe('writeBaseManifest', () => {
    let tempDir: string;

    beforeEach(async () => {
        tempDir = await mkdtemp(join(tmpdir(), 'onlook-base-manifest-'));
    });

    afterEach(async () => {
        await rm(tempDir, { recursive: true, force: true });
    });

    test('writes pretty-printed JSON with a trailing newline that parses via BaseManifestSchema', async () => {
        const manifest = emitBaseManifest({
            ...BASE_INPUT,
            aliasMapUrl: 'https://cdn.onlook.test/base/v1/alias-map.json',
        });
        const outPath = join(tempDir, 'base-manifest.json');

        await writeBaseManifest(manifest, outPath);

        const raw = await readFile(outPath, 'utf8');
        expect(raw.endsWith('\n')).toBe(true);
        // 2-space indent signal: a nested field should be prefixed by two spaces.
        expect(raw).toContain('\n  "abi"');

        const reparsed: unknown = JSON.parse(raw);
        expect(() => BaseManifestSchema.parse(reparsed)).not.toThrow();
        expect(BaseManifestSchema.parse(reparsed)).toEqual(manifest);
    });
});

describe('BaseManifestSchema — negative cases', () => {
    test('invalid platform rejects', () => {
        const manifest = emitBaseManifest(BASE_INPUT);
        const broken = { ...manifest, platform: 'web' };
        expect(() => BaseManifestSchema.parse(broken)).toThrow();
    });

    test('missing bundleUrl rejects', () => {
        const manifest = emitBaseManifest(BASE_INPUT);
        const { bundleUrl: _unused, ...missing } = manifest;
        expect(() => BaseManifestSchema.parse(missing)).toThrow();
    });

    test('non-URL bundleUrl rejects', () => {
        const manifest = emitBaseManifest(BASE_INPUT);
        const broken = { ...manifest, bundleUrl: 'not-a-url' };
        expect(() => BaseManifestSchema.parse(broken)).toThrow();
    });
});
