#!/usr/bin/env bun
/**
 * run-e2e.ts — thin wrapper around `maestro test` for Wave 1+ Validate lines.
 *
 * The task queue at `plans/onlook-mobile-client-task-queue.md` uses invocations
 * like `bun run mobile:e2e:ios -- 01-boot.yaml` from >30 Validate lines. Bun's
 * script-args passthrough does not concatenate into a path, so we take the
 * first positional arg (the flow filename, e.g. `00-smoke.yaml`), resolve it
 * under `apps/mobile-client/e2e/flows/` relative to this script's dir, and
 * exec `maestro test <resolved>`.
 *
 * Called from either `bun run mobile:e2e:ios -- <flow>` or
 * `bun run mobile:e2e:android -- <flow>`. The two scripts share this wrapper
 * because Maestro is cross-platform — it runs against whatever simulator /
 * emulator is booted, and the per-platform split in the queue exists to tell
 * the orchestrator which device to boot before dispatching the task, not to
 * change the maestro invocation itself.
 *
 * Usage:
 *   bun run scripts/run-e2e.ts 00-smoke.yaml
 *   bun run mobile:e2e:ios -- 01-boot.yaml
 *
 * Exit code mirrors `maestro test`'s. No flow argument defaults to
 * `00-smoke.yaml` so the script is runnable as a smoke check on its own.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

function main(): number {
    const argv = process.argv.slice(2);
    const flow = argv.find((a) => !a.startsWith('--')) ?? '00-smoke.yaml';
    const flowPath = resolve(import.meta.dir, '..', 'e2e', 'flows', flow);
    if (!existsSync(flowPath)) {
        console.error(`[run-e2e] flow file not found: ${flowPath}`);
        return 2;
    }
    console.log(`[run-e2e] maestro test ${flowPath}`);
    const result = spawnSync('maestro', ['test', flowPath], { stdio: 'inherit' });
    return result.status ?? 1;
}

process.exit(main());
