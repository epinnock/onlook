#!/usr/bin/env bun
/**
 * install-device.ts — install a built OnlookMobileClient.app onto a physical
 * iPhone via `ios-deploy`.
 *
 * This wraps the happy-path we validated on spectra-macmini against an iOS
 * 15.1 device: locate the newest signed `.app` bundle from Xcode's
 * DerivedData (or a local `./build/` tree) and hand it to `ios-deploy` with
 * `--justlaunch` so the launched process detaches instead of blocking on the
 * debugger. See `docs/install-on-device.md` for the manual walkthrough.
 *
 * Usage:
 *   bun run scripts/install-device.ts --device=<UDID>
 *   ONLOOK_DEVICE_UDID=<UDID> bun run scripts/install-device.ts
 *   bun run mobile:install:device -- --device=<UDID>    (package.json alias)
 *
 * Prereqs:
 *   - macOS host with `ios-deploy` on PATH (`brew install ios-deploy`).
 *   - A prior `bun run mobile:build:ios` (or Xcode Run) that produced a
 *     `Debug-iphoneos` build. Simulator builds live under `Debug-iphonesimulator`
 *     and are not accepted here.
 *
 * Exit code mirrors `ios-deploy`'s; non-zero on our own pre-flight failures.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

const BUNDLE_NAME = 'OnlookMobileClient.app';
const DERIVED_DATA_GLOB_PREFIX = 'OnlookMobileClient-';
const DEBUG_IPHONEOS_SEGMENT = ['Build', 'Products', 'Debug-iphoneos'] as const;

function parseDeviceUdid(argv: readonly string[]): string | undefined {
    const flag = argv.find((a) => a.startsWith('--device='));
    if (flag) {
        const value = flag.slice('--device='.length).trim();
        if (value.length > 0) return value;
    }
    const envValue = process.env.ONLOOK_DEVICE_UDID?.trim();
    if (envValue && envValue.length > 0) return envValue;
    return undefined;
}

/**
 * Return the most-recently-modified `OnlookMobileClient.app` from either the
 * package-local `./build/Build/Products/Debug-iphoneos/` tree (used by
 * `xcodebuild -derivedDataPath ./build ...`) or the user's global DerivedData
 * (`~/Library/Developer/Xcode/DerivedData/OnlookMobileClient-<hash>/...`),
 * whichever
 * is newer. Returns `undefined` if neither location contains a bundle.
 */
function locateNewestAppBundle(mobileClientRoot: string): string | undefined {
    const candidates: { path: string; mtimeMs: number }[] = [];

    const localDebug = resolve(
        mobileClientRoot,
        'build',
        ...DEBUG_IPHONEOS_SEGMENT,
        BUNDLE_NAME,
    );
    if (existsSync(localDebug)) {
        candidates.push({ path: localDebug, mtimeMs: statSync(localDebug).mtimeMs });
    }

    const derivedRoot = resolve(
        homedir(),
        'Library',
        'Developer',
        'Xcode',
        'DerivedData',
    );
    if (existsSync(derivedRoot)) {
        let entries: string[] = [];
        try {
            entries = readdirSync(derivedRoot);
        } catch {
            entries = [];
        }
        for (const name of entries) {
            if (!name.startsWith(DERIVED_DATA_GLOB_PREFIX)) continue;
            const candidate = resolve(
                derivedRoot,
                name,
                ...DEBUG_IPHONEOS_SEGMENT,
                BUNDLE_NAME,
            );
            if (existsSync(candidate)) {
                candidates.push({
                    path: candidate,
                    mtimeMs: statSync(candidate).mtimeMs,
                });
            }
        }
    }

    if (candidates.length === 0) return undefined;
    candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
    return candidates[0]!.path;
}

/**
 * Return `true` if `ios-deploy` resolves on PATH. We shell out to `command -v`
 * rather than scanning PATH ourselves so Windows/Linux callers (who are the
 * only hosts that can get this far without ios-deploy) get a consistent "not
 * found" signal.
 */
function iosDeployOnPath(): boolean {
    const result = spawnSync('ios-deploy', ['--version'], { stdio: 'ignore' });
    // ENOENT surfaces as result.error with code 'ENOENT'; anything else
    // (including a non-zero exit from `--version`, which ios-deploy does not
    // actually produce but we treat defensively) means the binary is resolvable.
    if (result.error && (result.error as NodeJS.ErrnoException).code === 'ENOENT') {
        return false;
    }
    return true;
}

/**
 * Run `ios-deploy --detect` and return the UDIDs of any USB-connected
 * iPhones it sees. Empty array means none found (or `ios-deploy` not on
 * PATH — caller should check `iosDeployOnPath()` first).
 *
 * `ios-deploy` emits lines like:
 *
 *   [....] Found 2f2b1f290e974ea4e5be913d2387cffb6e6ae834 (D211AP, iPhone 8 Plus,
 *          iphoneos, arm64, 15.1, 19B74) a.k.a. 'Ejiroghene's iPhone' connected
 *          through USB.
 *
 * The UDID is either 40 hex chars (modern A12+ devices) or
 * `<8-hex>-<16-hex>` (post-iPhone-X with new UDID format). Both shapes are
 * accepted.
 */
function detectConnectedDeviceUdids(timeoutSeconds = 5): readonly string[] {
    const result = spawnSync('ios-deploy', ['--detect', '--timeout', String(timeoutSeconds)], {
        encoding: 'utf8',
    });
    const stdout = (result.stdout ?? '') + (result.stderr ?? '');
    const found = new Set<string>();
    const re = /Found ([0-9a-f]{40}|[0-9A-F]{8}-[0-9A-F]{16})\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(stdout)) !== null) {
        if (m[1]) found.add(m[1]);
    }
    return [...found];
}

function main(): number {
    const argv = process.argv.slice(2);
    let udid = parseDeviceUdid(argv);

    // Auto-detect: if no UDID was supplied AND ios-deploy is on PATH AND
    // exactly one iPhone is plugged in, use it. We probe ios-deploy here
    // before the canonical iosDeployOnPath() check below so the missing-
    // udid error path stays exit 2 (rather than 127) when no auto-detect
    // is possible — preserves the long-standing user-error precedence.
    // 0 or 2+ devices on USB skip auto-detect (the multi-device case errors
    // explicitly so we never install the wrong build on shared hosts like
    // Mac mini farms or dev workstations with multiple test phones).
    if (!udid && iosDeployOnPath()) {
        const detected = detectConnectedDeviceUdids();
        if (detected.length === 1) {
            udid = detected[0];
            console.log(`[install-device] auto-detected device ${udid}`);
        } else if (detected.length > 1) {
            console.error(
                '[install-device] Multiple iPhones connected — refusing to ' +
                    'auto-pick. Pass --device=<UDID> or set ONLOOK_DEVICE_UDID. ' +
                    `Found: ${detected.join(', ')}`,
            );
            return 2;
        }
    }

    if (!udid) {
        console.error(
            '[install-device] Missing device UDID. Pass --device=<UDID> or ' +
                'set ONLOOK_DEVICE_UDID. See apps/mobile-client/docs/install-on-device.md ' +
                "section 3 (\"Finding the iPhone UDID\").",
        );
        return 2;
    }

    if (!iosDeployOnPath()) {
        console.error(
            '[install-device] `ios-deploy` not found on PATH. Install it with ' +
                '`brew install ios-deploy` (macOS only — Linux/Windows hosts ' +
                'cannot codesign or install to an iPhone).',
        );
        return 127;
    }

    const mobileClientRoot = resolve(import.meta.dir, '..');
    const appBundle = locateNewestAppBundle(mobileClientRoot);
    if (!appBundle) {
        console.error(
            `[install-device] No ${BUNDLE_NAME} found under ` +
                `${mobileClientRoot}/build/Build/Products/Debug-iphoneos/ or ` +
                '~/Library/Developer/Xcode/DerivedData/OnlookMobileClient-*/Build/Products/Debug-iphoneos/. ' +
                'Run `bun run mobile:build:ios` (or build via Xcode against a device destination) first.',
        );
        return 3;
    }

    const args = ['-i', udid, '--bundle', appBundle, '--justlaunch'];
    console.log(`[install-device] ios-deploy ${args.join(' ')}`);
    const result = spawnSync('ios-deploy', args, { stdio: 'inherit' });
    if (result.error && (result.error as NodeJS.ErrnoException).code === 'ENOENT') {
        // Guard against a race where `ios-deploy` disappears between the
        // probe and the real invocation (e.g. brew uninstall mid-run).
        console.error(
            '[install-device] `ios-deploy` disappeared from PATH between probe ' +
                'and launch. Reinstall with `brew install ios-deploy`.',
        );
        return 127;
    }
    return result.status ?? 1;
}

process.exit(main());
