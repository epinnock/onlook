/**
 * Run every `*.test.ts` file under `src/` in its OWN `bun test` process.
 *
 * Why: Bun's `mock.module(specifier, factory)` is process-wide and persists
 * across test files in a single `bun test` run. `routes/build.test.ts`
 * mocks `../../lib/hash` and that mock bleeds into `lib/hash.test.ts`,
 * causing the canonical-hash assertions to receive `'fixedhash000…'` from
 * the stubbed `sha256OfTar` instead of the real implementation.
 *
 * Bun 1.3.6 (local) appears to clear module mocks between files; bun 1.3.1
 * (CI) does not. Spawning each file in a fresh process gives us clean
 * isolation regardless of bun version.
 *
 * Mirrors `apps/mobile-client/scripts/run-tests-isolated.ts`.
 */

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const ROOT = resolve(import.meta.dir, '..');
const SRC = join(ROOT, 'src');

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full, out);
        else if (entry.isFile() && full.endsWith('.test.ts')) out.push(full);
    }
    return out;
}

const files = walk(SRC).sort();

let totalPass = 0;
let totalFail = 0;
const failingFiles: string[] = [];

for (const file of files) {
    const rel = relative(ROOT, file);
    const res = spawnSync('bun', ['test', file], {
        cwd: ROOT,
        stdio: ['ignore', 'pipe', 'pipe'],
        encoding: 'utf8',
    });
    const out = (res.stdout ?? '') + (res.stderr ?? '');
    const passMatch = out.match(/^\s*(\d+)\s+pass\s*$/m);
    const failMatch = out.match(/^\s*(\d+)\s+fail\s*$/m);
    const pass = passMatch ? Number(passMatch[1]) : 0;
    const fail = failMatch ? Number(failMatch[1]) : 0;
    totalPass += pass;
    totalFail += fail;
    if (res.status !== 0 || fail > 0) {
        failingFiles.push(rel);
        process.stdout.write(out);
        console.error(`\n[FAIL] ${rel} (pass=${pass} fail=${fail})\n`);
    } else {
        console.log(`[pass] ${rel} (${pass})`);
    }
}

console.log(`\n=== Summary ===`);
console.log(`Files: ${files.length}   pass: ${totalPass}   fail: ${totalFail}`);
if (failingFiles.length > 0) {
    console.log(`Failing files:\n  ${failingFiles.join('\n  ')}`);
    process.exit(1);
}
process.exit(0);
