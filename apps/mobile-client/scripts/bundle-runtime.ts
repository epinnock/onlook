#!/usr/bin/env bun
/**
 * bundle-runtime.ts — Phase F task MCF11.
 *
 * Copies packages/mobile-preview/runtime/bundle.js into the iOS and Android
 * asset directories at build time so the 241KB Onlook runtime (React 19.1.0 +
 * reconciler 0.32.0 + Fabric host config + Hermes polyfills) is baked into the
 * binary instead of shipped inside every user bundle the relay serves.
 *
 * Usage:
 *   bun run scripts/bundle-runtime.ts            # normal build-time invocation
 *   bun run scripts/bundle-runtime.ts --dry-run  # report what would happen, no writes
 *   bun run scripts/bundle-runtime.ts --dest-ios=/tmp/ios --dest-android=/tmp/a
 *
 * Emits alongside each copied bundle.js a sibling `onlook-runtime.meta.json`
 * file containing `{ version, sha256, copiedFrom, copiedAt }` so CI can detect
 * silent runtime drift across `feat/mobile-client`'s lifespan (source-plan
 * open question #2). The version field is asserted against
 * @onlook/mobile-client-protocol's ONLOOK_RUNTIME_VERSION; mismatch is a
 * hard fail.
 *
 * This script is deliberately tolerant of the iOS and Android destination
 * paths not existing yet — Phase F's MCF8 (expo prebuild) creates them, and
 * this script can be authored + unit-tested before MCF8 lands. Until the
 * native project trees exist, run with `--skip-missing` and the script will
 * log-and-skip missing destinations instead of erroring.
 */

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { ONLOOK_RUNTIME_VERSION } from '@onlook/mobile-client-protocol';

// ─── types ───────────────────────────────────────────────────────────────────

interface Options {
    dryRun: boolean;
    skipMissing: boolean;
    sourcePath: string;
    iosDest: string;
    androidDest: string;
}

interface CopyResult {
    platform: 'ios' | 'android';
    dest: string;
    skipped: boolean;
    skipReason?: string;
    bytes?: number;
    sha256?: string;
}

export interface RuntimeMeta {
    version: string;
    sha256: string;
    copiedFrom: string;
    copiedAt: string;
    bytes: number;
}

// ─── utilities ───────────────────────────────────────────────────────────────

function findRepoRoot(): string {
    // apps/mobile-client/scripts/bundle-runtime.ts → repo root is 3 levels up
    return resolve(import.meta.dir, '..', '..', '..');
}

function defaultOptions(): Options {
    const root = findRepoRoot();
    return {
        dryRun: false,
        skipMissing: false,
        sourcePath: join(root, 'packages', 'mobile-preview', 'runtime', 'bundle.js'),
        iosDest: join(
            root,
            'apps',
            'mobile-client',
            'ios',
            'OnlookMobile',
            'Resources',
            'onlook-runtime.js',
        ),
        androidDest: join(
            root,
            'apps',
            'mobile-client',
            'android',
            'app',
            'src',
            'main',
            'assets',
            'onlook-runtime.js',
        ),
    };
}

export function parseArgs(argv: readonly string[], base: Options): Options {
    const opts: Options = { ...base };
    for (const arg of argv) {
        if (arg === '--dry-run') {
            opts.dryRun = true;
        } else if (arg === '--skip-missing') {
            opts.skipMissing = true;
        } else if (arg.startsWith('--source=')) {
            opts.sourcePath = resolve(arg.slice('--source='.length));
        } else if (arg.startsWith('--dest-ios=')) {
            opts.iosDest = resolve(arg.slice('--dest-ios='.length));
        } else if (arg.startsWith('--dest-android=')) {
            opts.androidDest = resolve(arg.slice('--dest-android='.length));
        }
    }
    return opts;
}

export function sha256(buf: Buffer): string {
    return createHash('sha256').update(buf).digest('hex');
}

function metaPath(bundlePath: string): string {
    return bundlePath.replace(/\.js$/, '.meta.json');
}

function copyOne(
    platform: 'ios' | 'android',
    sourceBuf: Buffer,
    sourceAbs: string,
    dest: string,
    opts: Options,
): CopyResult {
    const parent = dirname(dest);
    if (!existsSync(parent)) {
        if (opts.skipMissing) {
            return {
                platform,
                dest,
                skipped: true,
                skipReason: `parent directory missing: ${parent}`,
            };
        }
        if (!opts.dryRun) {
            mkdirSync(parent, { recursive: true });
        }
    }
    const hash = sha256(sourceBuf);
    const meta: RuntimeMeta = {
        version: ONLOOK_RUNTIME_VERSION,
        sha256: hash,
        copiedFrom: sourceAbs,
        copiedAt: new Date().toISOString(),
        bytes: sourceBuf.length,
    };
    if (!opts.dryRun) {
        writeFileSync(dest, sourceBuf);
        writeFileSync(metaPath(dest), `${JSON.stringify(meta, null, 2)}\n`, 'utf8');
    }
    return {
        platform,
        dest,
        skipped: false,
        bytes: sourceBuf.length,
        sha256: hash,
    };
}

export function bundleRuntime(opts: Options): CopyResult[] {
    if (!existsSync(opts.sourcePath)) {
        throw new Error(
            `[bundle-runtime] source bundle not found at ${opts.sourcePath}. ` +
                `Run 'bun run build:mobile-runtime' in packages/mobile-preview first.`,
        );
    }
    const sourceStat = statSync(opts.sourcePath);
    if (sourceStat.size === 0) {
        throw new Error(`[bundle-runtime] source bundle at ${opts.sourcePath} is empty`);
    }
    const sourceBuf = readFileSync(opts.sourcePath);
    const results: CopyResult[] = [
        copyOne('ios', sourceBuf, opts.sourcePath, opts.iosDest, opts),
        copyOne('android', sourceBuf, opts.sourcePath, opts.androidDest, opts),
    ];
    return results;
}

// ─── CLI entry point ─────────────────────────────────────────────────────────

function main(): number {
    const opts = parseArgs(process.argv.slice(2), defaultOptions());
    const mode = opts.dryRun ? '[dry-run] ' : '';
    console.log(
        `${mode}[bundle-runtime] source: ${opts.sourcePath}\n` +
            `${mode}[bundle-runtime] iOS dest:     ${opts.iosDest}\n` +
            `${mode}[bundle-runtime] Android dest: ${opts.androidDest}`,
    );
    let results: CopyResult[];
    try {
        results = bundleRuntime(opts);
    } catch (err) {
        console.error(`${mode}[bundle-runtime] FAIL: ${(err as Error).message}`);
        return 1;
    }
    for (const r of results) {
        if (r.skipped) {
            console.warn(`${mode}[bundle-runtime] ${r.platform}: SKIP (${r.skipReason})`);
        } else {
            console.log(
                `${mode}[bundle-runtime] ${r.platform}: ${r.dest} ` +
                    `(${r.bytes} bytes, sha256=${r.sha256?.slice(0, 12)}...)`,
            );
        }
    }
    return 0;
}

// Only run main() when invoked directly, not when imported by the test file.
if (import.meta.main) {
    process.exit(main());
}
