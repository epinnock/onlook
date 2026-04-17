import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');
const MOBILE_CLIENT_ROOT = join(REPO_ROOT, 'apps', 'mobile-client');
const SCRIPT = join(MOBILE_CLIENT_ROOT, 'scripts', 'run-tests-isolated.ts');

interface RunResult {
    status: number | null;
    stdout: string;
    stderr: string;
}

// See note in validate-task.test.ts: bun:test's spawnSync pipe capture is
// unreliable for bun subprocesses on some platforms, so we redirect via sh.
function runRunner(testRoot: string): RunResult {
    const tmp = mkdtempSync(join(tmpdir(), 'run-tests-isolated-io-'));
    const outPath = join(tmp, 'stdout');
    const errPath = join(tmp, 'stderr');
    const cmd = `ONLOOK_TEST_ROOT='${testRoot.replace(/'/g, `'\\''`)}' bun run "${SCRIPT}" >"${outPath}" 2>"${errPath}"`;
    const result = spawnSync('sh', ['-c', cmd], { cwd: MOBILE_CLIENT_ROOT });
    const stdout = readFileSync(outPath, 'utf8');
    const stderr = readFileSync(errPath, 'utf8');
    rmSync(tmp, { recursive: true, force: true });
    return { status: result.status, stdout, stderr };
}

// Fixture trees: each test file uses bun:test directly, so the child bun
// process runs them natively. No mocking/imports are required — we just
// want a passing file and a failing file.
const FIXTURE_PASSING = `import { expect, test } from 'bun:test';
test('fixture pass a', () => { expect(1 + 1).toBe(2); });
test('fixture pass b', () => { expect('ok').toBe('ok'); });
`;

const FIXTURE_FAILING = `import { expect, test } from 'bun:test';
test('fixture fail', () => { expect(1).toBe(2); });
`;

let allPassRoot = '';
let mixedRoot = '';

beforeAll(() => {
    allPassRoot = mkdtempSync(join(tmpdir(), 'run-tests-isolated-pass-'));
    mkdirSync(join(allPassRoot, 'nested'), { recursive: true });
    writeFileSync(join(allPassRoot, 'a.test.ts'), FIXTURE_PASSING);
    writeFileSync(join(allPassRoot, 'nested', 'b.test.ts'), FIXTURE_PASSING);

    mixedRoot = mkdtempSync(join(tmpdir(), 'run-tests-isolated-mixed-'));
    writeFileSync(join(mixedRoot, 'good.test.ts'), FIXTURE_PASSING);
    writeFileSync(join(mixedRoot, 'bad.test.ts'), FIXTURE_FAILING);
});

afterAll(() => {
    if (allPassRoot) rmSync(allPassRoot, { recursive: true, force: true });
    if (mixedRoot) rmSync(mixedRoot, { recursive: true, force: true });
});

describe('run-tests-isolated.ts', () => {
    test('discovers nested *.test.ts files and reports aggregated pass counts with exit 0', () => {
        const result = runRunner(allPassRoot);
        const combined = result.stdout + result.stderr;
        expect(result.status).toBe(0);
        // Per-file pass lines confirm discovery walked into the subdir.
        expect(combined).toMatch(/\[pass\].*a\.test\.ts/);
        expect(combined).toMatch(/\[pass\].*nested\/b\.test\.ts/);
        // Summary shape: "Files: 2   pass: 4   fail: 0"
        expect(combined).toMatch(/=== Summary ===/);
        expect(combined).toMatch(/Files:\s*2\s+pass:\s*4\s+fail:\s*0/);
        expect(combined).not.toMatch(/Failing files:/);
    });

    test('exits non-zero and lists failing file when any test fails', () => {
        const result = runRunner(mixedRoot);
        const combined = result.stdout + result.stderr;
        expect(result.status).not.toBe(0);
        // Aggregated totals across the 1 passing + 1 failing file.
        expect(combined).toMatch(/Files:\s*2\s+pass:\s*2\s+fail:\s*1/);
        // Failing file should be called out by relative path.
        expect(combined).toMatch(/Failing files:/);
        expect(combined).toMatch(/bad\.test\.ts/);
        // The passing sibling is still recorded as passed.
        expect(combined).toMatch(/\[pass\].*good\.test\.ts/);
    });

    test('spawns one bun subprocess per test file (isolation guarantee)', () => {
        // Two fixture files means we expect exactly two per-file result
        // lines ("[pass] ..." or "[FAIL] ..."). This is a proxy for
        // "one subprocess per file"; if the runner ever batched them,
        // we'd see a single summary instead of per-file lines.
        const result = runRunner(allPassRoot);
        const combined = result.stdout + result.stderr;
        const perFileLines = combined.match(/^\[(pass|FAIL)\]/gm) ?? [];
        expect(perFileLines.length).toBe(2);
    });
});
