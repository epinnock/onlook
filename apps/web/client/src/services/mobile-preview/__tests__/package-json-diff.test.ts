import { describe, expect, test } from 'bun:test';

import {
    DEFAULT_DEPENDENCY_FIELDS,
    diffPackageDependencies,
    isDependencyDiffEmpty,
    listChangedSpecifiers,
} from '../package-json-diff';

const make = (deps: Record<string, string>) =>
    JSON.stringify({ name: 'app', version: '1.0.0', dependencies: deps });

describe('diffPackageDependencies', () => {
    test('null prev: every dependency lands in added', () => {
        const diff = diffPackageDependencies(null, make({ lodash: '^4.17.21' }));
        expect(diff.added).toEqual({ lodash: '^4.17.21' });
        expect(diff.removed).toEqual({});
        expect(diff.changed).toEqual({});
    });

    test('undefined prev: same as null', () => {
        const diff = diffPackageDependencies(undefined, make({ lodash: '^4.17.21' }));
        expect(diff.added).toEqual({ lodash: '^4.17.21' });
    });

    test('identical prev + next: everything unchanged, no ops', () => {
        const pkg = make({ lodash: '^4.17.21', zod: '^3.22.0' });
        const diff = diffPackageDependencies(pkg, pkg);
        expect(diff.unchanged).toEqual({ lodash: '^4.17.21', zod: '^3.22.0' });
        expect(isDependencyDiffEmpty(diff)).toBe(true);
    });

    test('added specifier', () => {
        const diff = diffPackageDependencies(
            make({ lodash: '^4.17.21' }),
            make({ lodash: '^4.17.21', zod: '^3.22.0' }),
        );
        expect(diff.added).toEqual({ zod: '^3.22.0' });
        expect(diff.unchanged).toEqual({ lodash: '^4.17.21' });
        expect(isDependencyDiffEmpty(diff)).toBe(false);
    });

    test('removed specifier', () => {
        const diff = diffPackageDependencies(
            make({ lodash: '^4.17.21', zod: '^3.22.0' }),
            make({ lodash: '^4.17.21' }),
        );
        expect(diff.removed).toEqual({ zod: '^3.22.0' });
        expect(diff.unchanged).toEqual({ lodash: '^4.17.21' });
    });

    test('version bump lands in changed with from/to', () => {
        const diff = diffPackageDependencies(
            make({ lodash: '^4.17.20' }),
            make({ lodash: '^4.17.21' }),
        );
        expect(diff.changed).toEqual({
            lodash: { from: '^4.17.20', to: '^4.17.21' },
        });
        expect(diff.added).toEqual({});
        expect(diff.removed).toEqual({});
    });

    test('tolerates malformed prev JSON — treats as empty, all next deps added', () => {
        const diff = diffPackageDependencies(
            'not-json{',
            make({ lodash: '^4.17.21' }),
        );
        expect(diff.added).toEqual({ lodash: '^4.17.21' });
    });

    test('tolerates malformed next JSON — treats as empty, all prev deps removed', () => {
        const diff = diffPackageDependencies(
            make({ lodash: '^4.17.21' }),
            'also-not-json',
        );
        expect(diff.removed).toEqual({ lodash: '^4.17.21' });
    });

    test('tolerates package.json with no dependencies field', () => {
        const empty = JSON.stringify({ name: 'app', version: '1.0.0' });
        const diff = diffPackageDependencies(
            empty,
            make({ lodash: '^4.17.21' }),
        );
        expect(diff.added).toEqual({ lodash: '^4.17.21' });
    });

    test('ignores non-string dependency values (npm spec technically allows git+url, object, etc.)', () => {
        // Pathological: `{"git-dep": {url: "…"}}` — we strip to avoid
        // type-laundering non-strings into the diff output.
        const pkg = JSON.stringify({
            dependencies: {
                'weird-obj': { url: 'x' },
                'normal': '^1.0.0',
            },
        });
        const diff = diffPackageDependencies(null, pkg);
        expect(diff.added).toEqual({ normal: '^1.0.0' });
    });

    test('fields override: pass devDependencies to include those in the diff', () => {
        const prev = JSON.stringify({
            dependencies: { a: '^1' },
            devDependencies: { b: '^1' },
        });
        const next = JSON.stringify({
            dependencies: { a: '^1' },
            devDependencies: { b: '^2' },
        });
        // Default (dependencies only) → no change.
        expect(
            isDependencyDiffEmpty(diffPackageDependencies(prev, next)),
        ).toBe(true);
        // Include devDependencies → the version bump surfaces.
        const withDev = diffPackageDependencies(prev, next, [
            'dependencies',
            'devDependencies',
        ]);
        expect(withDev.changed).toEqual({
            b: { from: '^1', to: '^2' },
        });
    });

    test('DEFAULT_DEPENDENCY_FIELDS is exactly [dependencies]', () => {
        // Regression guard — a future edit that adds devDependencies
        // to the default would silently pick up every dev-dep change
        // across the soak, flooding Q4 (package-install frequency)
        // with noise.
        expect(DEFAULT_DEPENDENCY_FIELDS).toEqual(['dependencies']);
    });
});

describe('listChangedSpecifiers', () => {
    test('collects added + removed + changed, omits unchanged, sorted', () => {
        const diff = diffPackageDependencies(
            make({ kept: '^1.0', removed: '^1.0', bumped: '^1.0' }),
            make({ kept: '^1.0', bumped: '^2.0', added: '^1.0' }),
        );
        expect(listChangedSpecifiers(diff)).toEqual([
            'added',
            'bumped',
            'removed',
        ]);
    });

    test('empty diff yields empty array', () => {
        const diff = diffPackageDependencies(
            make({ lodash: '^1' }),
            make({ lodash: '^1' }),
        );
        expect(listChangedSpecifiers(diff)).toEqual([]);
    });
});
