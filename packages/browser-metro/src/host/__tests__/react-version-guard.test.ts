import { describe, expect, test } from 'bun:test';
import {
    REQUIRED_REACT_VERSION,
    REQUIRED_RECONCILER_VERSION,
    checkReactVersions,
} from '../react-version-guard';

describe('checkReactVersions (MC6.4)', () => {
    test('exports the pinned runtime versions (React 19.1.0, reconciler 0.32.0)', () => {
        expect(REQUIRED_REACT_VERSION).toBe('19.1.0');
        expect(REQUIRED_RECONCILER_VERSION).toBe('0.32.0');
    });

    test('exact match on both deps → ok', () => {
        const result = checkReactVersions({
            react: '19.1.0',
            'react-reconciler': '0.32.0',
        });
        expect(result.ok).toBe(true);
    });

    test('wrong React major → error', () => {
        const result = checkReactVersions({
            react: '18.2.0',
            'react-reconciler': '0.32.0',
        });
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error('unreachable');
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toMatch(/react version mismatch/);
        expect(result.errors[0]).toContain('18.2.0');
        expect(result.errors[0]).toContain('19.1.0');
    });

    test('wrong React minor → error', () => {
        const result = checkReactVersions({
            react: '19.0.0',
            'react-reconciler': '0.32.0',
        });
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error('unreachable');
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toMatch(/react version mismatch/);
    });

    test('caret range matching major+minor is accepted (^19.1.0 with runtime 19.1.0)', () => {
        // ^19.1.0 resolves to the latest 19.x.y >= 19.1.0; as long as major+minor
        // match the pinned runtime we accept the range. Patch drift is allowed.
        const result = checkReactVersions({
            react: '^19.1.0',
            'react-reconciler': '^0.32.0',
        });
        expect(result.ok).toBe(true);
    });

    test('caret range with wrong minor is rejected (^19.0.0 ≠ 19.1.0)', () => {
        const result = checkReactVersions({
            react: '^19.0.0',
            'react-reconciler': '0.32.0',
        });
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error('unreachable');
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toMatch(/react version mismatch/);
    });

    test('tilde range matching major+minor is accepted (~19.1.5 with runtime 19.1.0)', () => {
        const result = checkReactVersions({
            react: '~19.1.5',
            'react-reconciler': '~0.32.0',
        });
        expect(result.ok).toBe(true);
    });

    test('tilde range with wrong minor is rejected (~19.2.0 ≠ 19.1.0)', () => {
        const result = checkReactVersions({
            react: '~19.2.0',
            'react-reconciler': '0.32.0',
        });
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error('unreachable');
        expect(result.errors[0]).toMatch(/react version mismatch/);
    });

    test('missing react dep → error', () => {
        const result = checkReactVersions({
            'react-reconciler': '0.32.0',
        });
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error('unreachable');
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toMatch(/Missing 'react' dependency/);
    });

    test('missing react-reconciler dep → error', () => {
        const result = checkReactVersions({
            react: '19.1.0',
        });
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error('unreachable');
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0]).toMatch(/Missing 'react-reconciler' dependency/);
    });

    test('both wrong → both errors reported in a single result', () => {
        const result = checkReactVersions({
            react: '18.3.0',
            'react-reconciler': '0.29.0',
        });
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error('unreachable');
        expect(result.errors).toHaveLength(2);
        expect(result.errors[0]).toMatch(/react version mismatch/);
        expect(result.errors[1]).toMatch(/react-reconciler version mismatch/);
    });

    test('both missing → both errors reported', () => {
        const result = checkReactVersions({});
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error('unreachable');
        expect(result.errors).toHaveLength(2);
        expect(result.errors[0]).toMatch(/Missing 'react' dependency/);
        expect(result.errors[1]).toMatch(/Missing 'react-reconciler' dependency/);
    });

    test('equals-prefix exact pin is accepted (=19.1.0)', () => {
        const result = checkReactVersions({
            react: '=19.1.0',
            'react-reconciler': '=0.32.0',
        });
        expect(result.ok).toBe(true);
    });

    test('exact pin with wrong patch is rejected (19.1.5 ≠ 19.1.0 when no range prefix)', () => {
        // When the user pins an exact version (no ^ or ~), we require exact
        // patch match too — otherwise the pin is lying about what will install.
        const result = checkReactVersions({
            react: '19.1.5',
            'react-reconciler': '0.32.0',
        });
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error('unreachable');
        expect(result.errors[0]).toMatch(/react version mismatch/);
    });

    test('malformed version string is rejected as a mismatch', () => {
        const result = checkReactVersions({
            react: 'latest',
            'react-reconciler': '0.32.0',
        });
        expect(result.ok).toBe(false);
        if (result.ok) throw new Error('unreachable');
        expect(result.errors[0]).toMatch(/react version mismatch/);
        expect(result.errors[0]).toContain('latest');
    });
});
