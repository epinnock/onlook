/**
 * Tests for the runtime capability classification — ADR-0001 task #3.
 *
 * These pin the policy gate the editor preflight consults before sending `overlayUpdate` over
 * the relay. Every case below maps to a specific line in the ABI ADR's "Import rules" table.
 */
import { describe, expect, test } from 'bun:test';
import {
    DISALLOWED_NATIVE_ALIASES,
    OPTIONAL_CAPABILITY_GROUPS,
    REQUIRED_ALIASES,
    buildRuntimeCapabilities,
    classifyImport,
    listSatisfiedOptionalCapabilityGroups,
} from '../src/runtime-capabilities';

describe('runtime-capabilities / classifyImport', () => {
    test('required aliases classify as required regardless of concrete alias list', () => {
        for (const spec of REQUIRED_ALIASES) {
            expect(classifyImport(spec, [])).toEqual({ allowed: true, tier: 'required' });
        }
    });

    test('aliases present in the concrete base classify as optional', () => {
        // react-native-safe-area-context happens to be required, so use a non-required but
        // concrete alias from the curated list: expo-status-bar (base curation includes it).
        expect(classifyImport('expo-status-bar', ['expo-status-bar'])).toEqual({
            allowed: true,
            tier: 'optional',
        });
    });

    test('disallowed native packages are rejected with native-only reason', () => {
        for (const spec of DISALLOWED_NATIVE_ALIASES) {
            expect(classifyImport(spec, [])).toEqual({
                allowed: false,
                tier: 'disallowed',
                reason: 'native-only',
            });
        }
    });

    test('unknown bare specifiers are rejected with not-in-base reason', () => {
        expect(classifyImport('definitely-not-shipped', [])).toEqual({
            allowed: false,
            tier: 'unknown',
            reason: 'not-in-base',
        });
    });

    test('disallowed policy beats "present in concrete" — safety net for accidental curation', () => {
        // Even if react-native-reanimated somehow landed in the concrete list, classifyImport
        // must still reject it: policy > curation mistakes.
        expect(
            classifyImport('react-native-reanimated', ['react-native-reanimated']),
        ).toEqual({ allowed: false, tier: 'disallowed', reason: 'native-only' });
    });
});

describe('runtime-capabilities / listSatisfiedOptionalCapabilityGroups', () => {
    test('empty concrete list satisfies no optional groups', () => {
        expect(listSatisfiedOptionalCapabilityGroups([])).toEqual([]);
    });

    test('partial membership does not satisfy the group', () => {
        const partialExpoCore = ['expo', 'expo-modules-core']; // missing expo-constants + expo-status-bar
        expect(listSatisfiedOptionalCapabilityGroups(partialExpoCore)).toEqual([]);
    });

    test('fully-satisfied group appears in the result', () => {
        const expoCoreMembers = OPTIONAL_CAPABILITY_GROUPS['expo-core'];
        expect(listSatisfiedOptionalCapabilityGroups(expoCoreMembers)).toContain('expo-core');
    });

    test('independent groups compose', () => {
        const combined = [
            ...OPTIONAL_CAPABILITY_GROUPS.svg,
            ...OPTIONAL_CAPABILITY_GROUPS.fonts,
        ];
        const satisfied = listSatisfiedOptionalCapabilityGroups(combined);
        expect(satisfied).toContain('svg');
        expect(satisfied).toContain('fonts');
    });
});

describe('runtime-capabilities / buildRuntimeCapabilities', () => {
    test('produces a RuntimeCapabilities record compatible with the abi-v1 schema', () => {
        const caps = buildRuntimeCapabilities({
            baseHash: 'deadbeef',
            rnVersion: '0.81.6',
            expoSdk: '54.0.0',
            platform: 'ios',
            concreteAliases: ['react', 'react-native', 'expo-status-bar'],
        });
        expect(caps.abi).toBe('v1');
        expect(caps.baseHash).toBe('deadbeef');
        expect(caps.rnVersion).toBe('0.81.6');
        expect(caps.expoSdk).toBe('54.0.0');
        expect(caps.platform).toBe('ios');
        expect(caps.aliases).toEqual(['react', 'react-native', 'expo-status-bar']);
    });

    test('defaults concreteAliases to the current curated list when omitted', () => {
        const caps = buildRuntimeCapabilities({
            baseHash: 'x',
            rnVersion: '0.81.6',
            expoSdk: '54.0.0',
            platform: 'ios',
        });
        // The curated list always contains every REQUIRED alias — that's the floor.
        for (const r of REQUIRED_ALIASES) {
            expect(caps.aliases).toContain(r);
        }
    });
});
