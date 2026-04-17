import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');
const SCRIPT = join(REPO_ROOT, 'apps', 'mobile-client', 'scripts', 'validate-task.ts');

interface RunResult {
    status: number | null;
    stdout: string;
    stderr: string;
}

// bun:test on macOS arm64 (Bun 1.3.9+) returns empty strings for child stdio
// pipes when spawnSync is called from a workspace-package test file. The
// child runs correctly (exit code is real), only the captured strings are
// blank. File-descriptor redirects are unaffected, so we capture via
// `sh -c` with `> file` redirection. When bun:test fixes the pipe bug this
// helper can collapse back to a plain spawnSync('bun', ['run', SCRIPT, ...]).
function runValidateTask(args: string[]): RunResult {
    const tmp = mkdtempSync(join(tmpdir(), 'validate-task-test-'));
    const outPath = join(tmp, 'stdout');
    const errPath = join(tmp, 'stderr');
    const quoted = args
        .map((a) => `'${a.replace(/'/g, `'\\''`)}'`)
        .join(' ');
    const cmd = `bun run "${SCRIPT}" ${quoted} >"${outPath}" 2>"${errPath}"`;
    const result = spawnSync('sh', ['-c', cmd], { cwd: REPO_ROOT });
    const stdout = readFileSync(outPath, 'utf8');
    const stderr = readFileSync(errPath, 'utf8');
    rmSync(tmp, { recursive: true, force: true });
    return { status: result.status, stdout, stderr };
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
