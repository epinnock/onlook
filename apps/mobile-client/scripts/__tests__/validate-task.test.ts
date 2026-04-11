import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');
const SCRIPT = join(REPO_ROOT, 'apps', 'mobile-client', 'scripts', 'validate-task.ts');

function runValidateTask(args: string[]): ReturnType<typeof spawnSync> {
    return spawnSync('bun', ['run', SCRIPT, ...args], {
        cwd: REPO_ROOT,
        encoding: 'utf8',
    });
}

describe('validate-task.ts', () => {
    test('exits with usage error when no task ID is given', () => {
        const result = runValidateTask([]);
        expect(result.status).toBe(2);
        expect(result.stderr).toMatch(/Usage:/);
    });

    test('parses MCF0 from the task queue in --dry-run mode', () => {
        // MCF0's validate line is the git rev-parse check — use dry-run so
        // we exercise the parser without actually running git commands in
        // a subshell during the test.
        const result = runValidateTask(['MCF0', '--dry-run']);
        expect(result.status).toBe(0);
        expect(result.stdout).toMatch(/MCF0 →/);
        expect(result.stdout).toMatch(/dry-run, not executing/);
    });

    test('parses MCF7 (bun test path) in --dry-run mode', () => {
        const result = runValidateTask(['MCF7', '--dry-run']);
        expect(result.status).toBe(0);
        expect(result.stdout).toMatch(/MCF7 →/);
        expect(result.stdout).toMatch(/bun test/);
    });

    test('errors on unknown task ID', () => {
        const result = runValidateTask(['MC99.99', '--dry-run']);
        expect(result.status).not.toBe(0);
        expect(result.stderr).toMatch(/not found/);
    });
});
