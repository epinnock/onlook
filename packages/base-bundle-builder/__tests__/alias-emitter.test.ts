import { describe, expect, test } from 'bun:test';

import {
    createAliasEmitterOutput,
    createAliasEmitterSidecar,
    stringifyAliasEmitterSidecar,
} from '../src/alias-emitter';
import { createAliasMap } from '../src/adapter/alias-map';

describe('alias-emitter', () => {
    test('emits deterministic sidecar output from array and record inputs', () => {
        const fromArray = createAliasEmitterOutput([
            { specifier: 'react-native', moduleId: 42 },
            { specifier: 'react', moduleId: 1 },
        ]);
        const fromRecord = createAliasEmitterOutput({
            react: 1,
            'react-native': 42,
        });

        expect(fromArray.aliasMap.entries).toEqual([
            { specifier: 'react', moduleId: 1 },
            { specifier: 'react-native', moduleId: 42 },
        ]);
        expect(fromArray.sidecar).toEqual({
            aliases: {
                react: 1,
                'react-native': 42,
            },
            specifiers: ['react', 'react-native'],
        });
        expect(fromArray.sidecarJson).toBe(
            '{"aliases":{"react":1,"react-native":42},"specifiers":["react","react-native"]}',
        );
        expect(fromRecord.sidecarJson).toBe(fromArray.sidecarJson);
    });

    test('stringifies a prebuilt alias map sidecar deterministically', () => {
        const aliasMap = createAliasMap({
            'react-native-safe-area-context': 99,
            react: 1,
        });

        expect(createAliasEmitterSidecar(aliasMap)).toEqual({
            aliases: {
                react: 1,
                'react-native-safe-area-context': 99,
            },
            specifiers: ['react', 'react-native-safe-area-context'],
        });
        expect(stringifyAliasEmitterSidecar(aliasMap)).toBe(
            '{"aliases":{"react":1,"react-native-safe-area-context":99},"specifiers":["react","react-native-safe-area-context"]}',
        );
    });

    test('rejects duplicate and invalid aliases through the alias map validator', () => {
        expect(() =>
            createAliasEmitterOutput([
                { specifier: 'react', moduleId: 1 },
                { specifier: 'react', moduleId: 2 },
            ]),
        ).toThrow('Alias map contains duplicate specifier "react"');

        expect(() =>
            createAliasEmitterOutput({
                '': 1,
            }),
        ).toThrow('Alias map specifier must be a non-empty string');

        expect(() =>
            createAliasEmitterOutput({
                react: 1.5,
            }),
        ).toThrow('Alias map entry for "react" must use an integer module id');
    });
});
