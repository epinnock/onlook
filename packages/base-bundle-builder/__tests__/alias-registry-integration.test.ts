/**
 * Synthetic Metro registry integration — task #12 of two-tier-overlay-v2.
 *
 * Proves the base-build → alias-emitter → OnlookRuntime.require chain works
 * end-to-end against a fake Metro registry. If this regresses, overlays
 * would silently receive `undefined` for bare imports that the base bundle
 * was supposed to serve.
 *
 * Deliberately lives in base-bundle-builder so the round-trip can be
 * exercised without pulling in the mobile-preview runtime package's
 * TypeScript. We re-implement a minimal `require(spec)` stub inline — the
 * real implementation is in packages/mobile-preview/runtime/src/onlook-runtime-js.ts.
 */
import { describe, expect, test } from 'bun:test';

import { createAliasEmitterOutput } from '../src/alias-emitter';
import { emitBaseManifest } from '../src/base-manifest';

interface FakeMetroRegistry {
    get(id: number): unknown;
}

function makeRegistry(modules: Record<number, unknown>): FakeMetroRegistry {
    return {
        get(id: number): unknown {
            if (!(id in modules)) {
                throw new Error(`Metro registry: module ${id} not found`);
            }
            return modules[id];
        },
    };
}

/**
 * Minimal OnlookRuntime.require stand-in — composes alias-emitter + a fake
 * Metro registry. This is the exact code path the JS-fallback runtime
 * exercises at runtime.
 */
function makeRequire(
    aliases: Readonly<Record<string, number>>,
    registry: FakeMetroRegistry,
): (spec: string) => unknown {
    return (spec: string) => {
        const moduleId = aliases[spec];
        if (moduleId === undefined) {
            throw new Error(`OnlookRuntime.require: unknown specifier "${spec}"`);
        }
        return registry.get(moduleId);
    };
}

describe('base-bundle alias-emitter × fake Metro registry', () => {
    test('require(spec) returns the module at the aliased id', () => {
        const reactStub = { createElement: () => null, __brand: 'react' };
        const rnStub = { View: () => null, Text: () => null, __brand: 'rn' };

        const emitted = createAliasEmitterOutput({
            modules: [
                { specifier: 'react', moduleId: 10 },
                { specifier: 'react-native', moduleId: 11 },
            ],
        });
        const registry = makeRegistry({ 10: reactStub, 11: rnStub });
        const require = makeRequire(emitted.sidecar.aliases, registry);

        expect(require('react')).toBe(reactStub);
        expect(require('react-native')).toBe(rnStub);
    });

    test('require(unknown) surfaces the contract error with clear message', () => {
        const emitted = createAliasEmitterOutput({
            modules: [{ specifier: 'react', moduleId: 0 }],
        });
        const registry = makeRegistry({ 0: {} });
        const require = makeRequire(emitted.sidecar.aliases, registry);

        expect(() => require('missing-pkg')).toThrow(
            /unknown specifier "missing-pkg"/,
        );
    });

    test('sidecar specifiers match the registry insertion order when kept sorted', () => {
        const emitted = createAliasEmitterOutput({
            modules: [
                { specifier: 'react-native', moduleId: 2 },
                { specifier: 'react', moduleId: 1 },
                { specifier: 'expo-status-bar', moduleId: 3 },
            ],
        });
        // The emitter sorts alphabetically for determinism.
        expect([...emitted.sidecar.specifiers]).toEqual([
            'expo-status-bar',
            'react',
            'react-native',
        ]);
    });

    test('base manifest carries the exact alias list a phone can validate against', () => {
        const emitted = createAliasEmitterOutput({
            modules: [
                { specifier: 'react', moduleId: 1 },
                { specifier: 'react-native', moduleId: 2 },
            ],
        });
        const manifest = emitBaseManifest({
            bundleBytes: new Uint8Array([0, 1, 2]),
            aliasSidecarJson: emitted.sidecarJson,
            rnVersion: '0.81.6',
            expoSdk: '54.0.0',
            reactVersion: '19.1.4',
            platform: 'ios',
            bundleUrl: 'https://r2/base/xxx/bundle.js',
            concreteAliases: ['react', 'react-native'],
        });
        expect(manifest.aliases).toEqual(['react', 'react-native']);
        // A phone carrying this manifest and an editor building against it
        // agree on exactly the specifiers the base bundle serves.
        for (const spec of manifest.aliases) {
            expect(emitted.sidecar.aliases[spec]).toBeDefined();
        }
    });

    test('adding a new alias to the base bundle changes the aliasHash', () => {
        const before = createAliasEmitterOutput({
            modules: [{ specifier: 'react', moduleId: 1 }],
        });
        const after = createAliasEmitterOutput({
            modules: [
                { specifier: 'react', moduleId: 1 },
                { specifier: 'react-native', moduleId: 2 },
            ],
        });
        expect(before.sidecarJson).not.toBe(after.sidecarJson);

        const m1 = emitBaseManifest({
            bundleBytes: new Uint8Array([0]),
            aliasSidecarJson: before.sidecarJson,
            rnVersion: '0.81.6',
            expoSdk: '54.0.0',
            reactVersion: '19.1.4',
            platform: 'ios',
            bundleUrl: 'https://r2/b1',
        });
        const m2 = emitBaseManifest({
            bundleBytes: new Uint8Array([0]),
            aliasSidecarJson: after.sidecarJson,
            rnVersion: '0.81.6',
            expoSdk: '54.0.0',
            reactVersion: '19.1.4',
            platform: 'ios',
            bundleUrl: 'https://r2/b1',
        });
        expect(m1.aliasHash).not.toBe(m2.aliasHash);
        expect(m1.bundleHash).toBe(m2.bundleHash); // same bundle bytes
    });
});
