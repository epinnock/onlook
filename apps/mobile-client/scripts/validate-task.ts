#!/usr/bin/env bun
/**
 * validate-task.ts — Phase F task MCF13.
 *
 * Reads a task ID from the command line, looks it up in
 * `plans/onlook-mobile-client-task-queue.md`, extracts the `Validate:` line,
 * runs it from the repo root, updates `apps/mobile-client/verification/results.json`
 * with pass/fail + timestamp, and exits 0 or 1.
 *
 * Usage:
 *   bun run scripts/validate-task.ts MCF7
 *   bun run scripts/validate-task.ts MC3.21 --dry-run
 *
 * The orchestrator calls this once per task after the agent finishes editing
 * files in the worktree. CI calls it via the mobile-client workflow.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

interface ResultsFile {
    flows: Record<
        string,
        {
            state: 'passed' | 'failed' | 'pending' | 'dead-letter';
            validated_at?: string;
            validate_command?: string;
            exit_code?: number;
            stderr_tail?: string;
        }
    >;
}

interface TaskEntry {
    id: string;
    validate: string;
}

function findRepoRoot(): string {
    // `validate-task.ts` lives at apps/mobile-client/scripts/, so the monorepo
    // root is two levels up from __dirname. Use import.meta.dir for Bun.
    const here = import.meta.dir;
    return resolve(here, '..', '..', '..');
}

function parseQueue(queuePath: string, taskId: string): TaskEntry {
    if (!existsSync(queuePath)) {
        throw new Error(`Task queue not found at ${queuePath}`);
    }
    const md = readFileSync(queuePath, 'utf8');
    // Task entries look like:
    //   - **MCF7** — Runtime version constant + compatibility matrix
    //     - Files: ...
    //     - Deps: ...
    //     - Validate: `bun test ...`
    //
    // Match the task header, then find the first `Validate:` line before the
    // next task header or section break.
    const escapedId = taskId.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const headerRegex = new RegExp(`^- \\*\\*${escapedId}\\*\\*`, 'm');
    const headerMatch = headerRegex.exec(md);
    if (!headerMatch) {
        throw new Error(`Task ${taskId} not found in queue at ${queuePath}`);
    }
    const after = md.slice(headerMatch.index);
    // The next task starts with `- **MC` at the beginning of a line.
    const nextHeaderRegex = /\n- \*\*MC[^*]+\*\*/;
    const nextMatch = nextHeaderRegex.exec(after.slice(1));
    const block = nextMatch ? after.slice(0, 1 + nextMatch.index) : after;
    const validateRegex = /Validate:\s*`([^`]+)`/;
    const vm = validateRegex.exec(block);
    if (!vm?.[1]) {
        throw new Error(
            `Task ${taskId} has no parseable \`Validate: \`backtick\`\` line in its block`,
        );
    }
    return { id: taskId, validate: vm[1] };
}

function readResults(path: string): ResultsFile {
    if (!existsSync(path)) {
        return { flows: {} };
    }
    const text = readFileSync(path, 'utf8');
    const json = JSON.parse(text) as unknown;
    if (typeof json !== 'object' || json === null || !('flows' in json)) {
        return { flows: {} };
    }
    return json as ResultsFile;
}

function writeResults(path: string, data: ResultsFile): void {
    writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function main(): number {
    const argv = process.argv.slice(2);
    const dryRun = argv.includes('--dry-run');
    const taskId = argv.find((a) => !a.startsWith('--'));
    if (!taskId) {
        console.error('Usage: bun run validate-task.ts <TASK_ID> [--dry-run]');
        return 2;
    }
    const repoRoot = findRepoRoot();
    const queuePath = join(repoRoot, 'plans', 'onlook-mobile-client-task-queue.md');
    const resultsPath = join(
        repoRoot,
        'apps',
        'mobile-client',
        'verification',
        'results.json',
    );

    const task = parseQueue(queuePath, taskId);
    console.log(`[validate-task] ${task.id} → ${task.validate}`);

    if (dryRun) {
        console.log('[validate-task] dry-run, not executing');
        return 0;
    }

    const result = spawnSync('bash', ['-lc', task.validate], {
        cwd: repoRoot,
        stdio: ['inherit', 'inherit', 'pipe'],
        encoding: 'utf8',
    });
    const exitCode = result.status ?? 1;
    const stderrTail = (result.stderr ?? '').split('\n').slice(-20).join('\n');

    const results = readResults(resultsPath);
    results.flows[task.id] = {
        state: exitCode === 0 ? 'passed' : 'failed',
        validated_at: new Date().toISOString(),
        validate_command: task.validate,
        exit_code: exitCode,
        stderr_tail: stderrTail,
    };
    writeResults(resultsPath, results);

    console.log(
        `[validate-task] ${task.id} → ${exitCode === 0 ? 'PASS' : 'FAIL'} (exit ${exitCode})`,
    );
    return exitCode;
}

process.exit(main());
