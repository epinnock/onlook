import { describe, expect, test } from 'bun:test';
import { rewriteBareImports } from '../bare-import-rewriter';

const ESM = 'https://esm.sh';
const DEFAULT_QUERY = '?bundle';

describe('rewriteBareImports', () => {
    test('1. rewrites default import of react', () => {
        const src = `import React from 'react'`;
        const { code, bareImports } = rewriteBareImports(src, { esmUrl: ESM });
        expect(code).toBe(`import React from '${ESM}/react${DEFAULT_QUERY}'`);
        expect(bareImports).toEqual(['react']);
    });

    test('2. aliases react-native -> react-native-web (original name retained in bareImports)', () => {
        const src = `import { View } from 'react-native'`;
        const { code, bareImports } = rewriteBareImports(src, { esmUrl: ESM });
        expect(code).toBe(`import { View } from '${ESM}/react-native-web${DEFAULT_QUERY}'`);
        expect(bareImports).toEqual(['react-native']);
    });

    test('3. relative ./Hello import is left untouched', () => {
        const src = `import './Hello'`;
        const { code, bareImports } = rewriteBareImports(src, { esmUrl: ESM });
        expect(code).toBe(src);
        expect(bareImports).toEqual([]);
    });

    test('4. relative ../utils import is left untouched', () => {
        const src = `import '../utils'`;
        const { code, bareImports } = rewriteBareImports(src, { esmUrl: ESM });
        expect(code).toBe(src);
        expect(bareImports).toEqual([]);
    });

    test('5. absolute /abs/path import is left untouched', () => {
        const src = `import '/abs/path'`;
        const { code, bareImports } = rewriteBareImports(src, { esmUrl: ESM });
        expect(code).toBe(src);
        expect(bareImports).toEqual([]);
    });

    test('6. http(s) URL import is left untouched', () => {
        const src = `import 'https://example.com/foo.js'`;
        const { code, bareImports } = rewriteBareImports(src, { esmUrl: ESM });
        expect(code).toBe(src);
        expect(bareImports).toEqual([]);
    });

    test('7. rewrites named import from expo-status-bar', () => {
        const src = `import { StatusBar } from 'expo-status-bar'`;
        const { code, bareImports } = rewriteBareImports(src, { esmUrl: ESM });
        expect(code).toBe(`import { StatusBar } from '${ESM}/expo-status-bar${DEFAULT_QUERY}'`);
        expect(bareImports).toEqual(['expo-status-bar']);
    });

    test('8. rewrites re-export from a bare specifier', () => {
        const src = `export { foo } from 'react'`;
        const { code, bareImports } = rewriteBareImports(src, { esmUrl: ESM });
        expect(code).toBe(`export { foo } from '${ESM}/react${DEFAULT_QUERY}'`);
        expect(bareImports).toEqual(['react']);
    });

    test('9. dedupes multiple imports of the same package', () => {
        const src = [
            `import React from 'react'`,
            `import { useState } from 'react'`,
            `export { Fragment } from 'react'`,
        ].join('\n');
        const { bareImports } = rewriteBareImports(src, { esmUrl: ESM });
        expect(bareImports).toEqual(['react']);
    });

    test('10. mixed: 1 relative + 2 bare yields 2 entries', () => {
        const src = [
            `import './Local'`,
            `import React from 'react'`,
            `import { View } from 'react-native'`,
        ].join('\n');
        const { code, bareImports } = rewriteBareImports(src, { esmUrl: ESM });
        expect(bareImports).toHaveLength(2);
        expect(bareImports).toContain('react');
        expect(bareImports).toContain('react-native');
        expect(code).toContain(`'./Local'`);
        expect(code).toContain(`${ESM}/react${DEFAULT_QUERY}`);
        expect(code).toContain(`${ESM}/react-native-web${DEFAULT_QUERY}`);
    });

    test('11. preserves sub-paths like lodash/fp', () => {
        const src = `import { fp } from 'lodash/fp'`;
        const { code, bareImports } = rewriteBareImports(src, { esmUrl: ESM });
        expect(code).toBe(`import { fp } from '${ESM}/lodash/fp${DEFAULT_QUERY}'`);
        expect(bareImports).toEqual(['lodash/fp']);
    });

    test('12. preserves scoped packages like @reach/router', () => {
        const src = `import { Link } from '@reach/router'`;
        const { code, bareImports } = rewriteBareImports(src, { esmUrl: ESM });
        expect(code).toBe(`import { Link } from '${ESM}/@reach/router${DEFAULT_QUERY}'`);
        expect(bareImports).toEqual(['@reach/router']);
    });

    test('13. honors a custom external list', () => {
        const src = `import { createSignal } from 'solid-js'`;
        const { code } = rewriteBareImports(src, {
            esmUrl: ESM,
            external: ['solid-js'],
        });
        expect(code).toBe(
            `import { createSignal } from '${ESM}/solid-js?bundle&external=solid-js'`,
        );
    });

    test('14. honors a custom alias map', () => {
        const src = `import 'foo'`;
        const { code, bareImports } = rewriteBareImports(src, {
            esmUrl: ESM,
            aliases: { foo: 'bar' },
        });
        expect(code).toBe(`import '${ESM}/bar${DEFAULT_QUERY}'`);
        expect(bareImports).toEqual(['foo']);
    });

    test('15. strips trailing slash from esmUrl to avoid double slash', () => {
        const src = `import React from 'react'`;
        const { code } = rewriteBareImports(src, { esmUrl: 'https://esm.sh/' });
        expect(code).toBe(`import React from 'https://esm.sh/react${DEFAULT_QUERY}'`);
        expect(code).not.toContain('//react');
    });

    test('handles dynamic import() forms', () => {
        const src = `const m = await import('expo-status-bar')`;
        const { code, bareImports } = rewriteBareImports(src, { esmUrl: ESM });
        expect(code).toBe(`const m = await import('${ESM}/expo-status-bar${DEFAULT_QUERY}')`);
        expect(bareImports).toEqual(['expo-status-bar']);
    });

    test('handles namespace imports (* as)', () => {
        const src = `import * as React from 'react'`;
        const { code, bareImports } = rewriteBareImports(src, { esmUrl: ESM });
        expect(code).toBe(`import * as React from '${ESM}/react${DEFAULT_QUERY}'`);
        expect(bareImports).toEqual(['react']);
    });

    test('handles default + named combined import', () => {
        const src = `import React, { useState, useEffect } from 'react'`;
        const { code, bareImports } = rewriteBareImports(src, { esmUrl: ESM });
        expect(code).toBe(
            `import React, { useState, useEffect } from '${ESM}/react${DEFAULT_QUERY}'`,
        );
        expect(bareImports).toEqual(['react']);
    });

    test('handles export * from a bare spec', () => {
        const src = `export * from 'react'`;
        const { code, bareImports } = rewriteBareImports(src, { esmUrl: ESM });
        expect(code).toBe(`export * from '${ESM}/react${DEFAULT_QUERY}'`);
        expect(bareImports).toEqual(['react']);
    });

    test('handles double-quoted specifiers', () => {
        const src = `import React from "react"`;
        const { code, bareImports } = rewriteBareImports(src, { esmUrl: ESM });
        expect(code).toBe(`import React from "${ESM}/react${DEFAULT_QUERY}"`);
        expect(bareImports).toEqual(['react']);
    });
});
