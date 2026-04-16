#!/usr/bin/env bun
/**
 * MCI.3 — Bundle size audit.
 *
 * Bundles a fixture twice (target: 'expo-go' prod vs 'onlook-client' dev) and
 * reports raw byte sizes + delta as JSON on stdout, with a human summary on
 * stderr. The intent is to quantify the overhead of the Onlook inspector
 * instrumentation (`__source` injection from MC4.12/MC4.13) relative to a
 * vanilla Expo Go bundle.
 *
 * Usage:
 *   bun run packages/browser-metro/scripts/bundle-size-audit.ts [entry.tsx]
 *   bun run packages/browser-metro/scripts/bundle-size-audit.ts --fixture=hello-onlook
 *
 * The optional positional argument is the path to a single-file fixture; if
 * omitted, defaults to `fixtures/minimal-app.tsx` in this package. The
 * `--fixture=<name>` flag resolves `fixtures/<name>.tsx` relative to this
 * package and, when set, gates exit code on the `onlook-client` measurement
 * exceeding `ONLOOK_CLIENT_BUDGET_BYTES` (20 KiB).
 */
import { BrowserMetro } from '../src';
import type { Vfs } from '../src/host/types';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const ONLOOK_CLIENT_BUDGET_BYTES = 20480;

// Parse a single optional `--fixture=<name>` flag; anything else is treated
// as a positional path (back-compat with the pre-MCI.3-followup invocation).
let fixtureName: string | null = null;
const positional: string[] = [];
for (const arg of process.argv.slice(2)) {
    if (arg.startsWith('--fixture=')) {
        fixtureName = arg.slice('--fixture='.length);
    } else {
        positional.push(arg);
    }
}

const entryPath = fixtureName
    ? resolve(import.meta.dir, '..', 'fixtures', `${fixtureName}.tsx`)
    : (positional[0] ?? resolve(import.meta.dir, '..', 'fixtures', 'minimal-app.tsx'));
const entrySource = readFileSync(entryPath, 'utf8');
// Entry resolver requires a canonical entry name (App.tsx, index.tsx, ...).
// We always expose the fixture as `App.tsx` inside the audit vfs regardless
// of what it's named on disk.
const entryName = 'App.tsx';

function makeFixtureVfs(name: string, code: string): Vfs {
    return {
        async listAll() {
            return [{ path: `/${name}`, type: 'file' as const }];
        },
        async readFile(path: string) {
            const key = path.startsWith('/') ? path.slice(1) : path;
            if (key !== name) {
                throw new Error(`audit vfs: missing ${path}`);
            }
            return code;
        },
    };
}

async function bundleWith(
    target: 'expo-go' | 'onlook-client',
    isDev: boolean,
): Promise<number> {
    const metro = new BrowserMetro({
        vfs: makeFixtureVfs(entryName, entrySource),
        esmUrl: 'https://esm.sh',
        target,
        isDev,
        logger: { debug: () => {}, info: () => {}, error: () => {} },
    });
    try {
        const result = await metro.bundle();
        return Buffer.byteLength(result.iife, 'utf8');
    } finally {
        metro.dispose();
    }
}

const expoGo = await bundleWith('expo-go', false);
const onlookClient = await bundleWith('onlook-client', true);
const delta = onlookClient - expoGo;
const pct = ((delta / expoGo) * 100).toFixed(2);

const report = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    entry: entryPath,
    fixture: fixtureName ?? null,
    budget: {
        target: 'onlook-client' as const,
        bytes: ONLOOK_CLIENT_BUDGET_BYTES,
        human: `${(ONLOOK_CLIENT_BUDGET_BYTES / 1024).toFixed(1)} KB`,
    },
    expoGo: {
        bytes: expoGo,
        human: `${(expoGo / 1024).toFixed(1)} KB`,
    },
    onlookClient: {
        bytes: onlookClient,
        human: `${(onlookClient / 1024).toFixed(1)} KB`,
    },
    delta: {
        bytes: delta,
        human: `${(delta / 1024).toFixed(1)} KB`,
        pct: `+${pct}%`,
    },
};

console.log(JSON.stringify(report, null, 2));
process.stderr.write(
    `expo-go: ${expoGo} B | onlook-client: ${onlookClient} B | delta: +${delta} B (+${pct}%)\n`,
);

if (onlookClient > ONLOOK_CLIENT_BUDGET_BYTES) {
    process.stderr.write(
        `bundle-size-audit: onlook-client bundle ${onlookClient} B exceeds budget ${ONLOOK_CLIENT_BUDGET_BYTES} B` +
            (fixtureName ? ` for fixture '${fixtureName}'\n` : '\n'),
    );
    process.exit(1);
}
