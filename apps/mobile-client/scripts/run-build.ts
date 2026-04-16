#!/usr/bin/env bun
/**
 * run-build.ts — thin wrapper around `xcodebuild` for Wave 1+ Validate lines.
 *
 * The task queue at `plans/onlook-mobile-client-task-queue.md` uses invocations
 * like `bun run mobile:build:ios && bun run mobile:e2e:ios -- 01-boot.yaml`
 * from 20+ Validate lines (MC1.1–MC1.7, parts of Waves 2–5). This wrapper
 * exists so the Validate strings work verbatim when validate-task.ts runs
 * them from repo root.
 *
 * Design notes:
 *   - Default destination is `generic/platform=iOS Simulator` (no device
 *     name). A build-only validation doesn't need a specific booted device,
 *     and this avoids the iPhone 15 / iPhone 16 / iPhone 17 drift that
 *     comes with each Xcode bump (Xcode 15.4 ships iPhone 15, Xcode 16.x
 *     ships iPhone 16, etc.). Maestro picks up whatever specific device is
 *     booted at run:ios time; the build itself doesn't care.
 *   - Pass `--sim=<name>` to force a specific simulator (e.g. for local
 *     repro of a device-specific build phase). The wrapper then uses
 *     `platform=iOS Simulator,name=<name>` as the destination.
 *   - `CODE_SIGNING_ALLOWED=NO` since simulator builds don't need signing
 *     and requiring a dev identity would break CI.
 *   - iOS only for now. Android (`mobile:build:android`) is deferred with
 *     the rest of the Android-side Wave 1 tasks per the handoff doc's
 *     "iOS first" cut line.
 *
 * Usage:
 *   bun run scripts/run-build.ts
 *   bun run scripts/run-build.ts --sim='iPhone 16'
 *   bun run mobile:build:ios                    (package.json alias)
 *
 * Exit code mirrors `xcodebuild`'s.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const WORKSPACE = 'OnlookMobileClient.xcworkspace';
const SCHEME = 'OnlookMobileClient';

function main(): number {
    const argv = process.argv.slice(2);
    const simArg = argv.find((a) => a.startsWith('--sim='));
    const simName = simArg ? simArg.slice('--sim='.length) : undefined;
    const destination = simName
        ? `platform=iOS Simulator,name=${simName}`
        : 'generic/platform=iOS Simulator';

    const iosDir = resolve(import.meta.dir, '..', 'ios');
    if (!existsSync(resolve(iosDir, WORKSPACE))) {
        console.error(
            `[run-build] ${WORKSPACE} not found under ${iosDir}. ` +
                `Run \`bun x expo prebuild --platform ios\` first (MCF8b).`,
        );
        return 2;
    }

    // MC2.12: regenerate OnlookRuntime_version.generated.h from
    // @onlook/mobile-client-protocol's ONLOOK_RUNTIME_VERSION before the
    // runtime bundle step so OnlookRuntime_version.cpp compiles against
    // the current constant. The header is .gitignored — without this
    // step a fresh clone wouldn't build and a stale copy would drift
    // silently from the TS source of truth.
    const versionHeaderPath = resolve(
        import.meta.dir,
        'generate-version-header.ts',
    );
    console.log(`[run-build] bun run ${versionHeaderPath}`);
    const versionResult = spawnSync('bun', ['run', versionHeaderPath], {
        stdio: 'inherit',
    });
    if (versionResult.status !== 0) {
        return versionResult.status ?? 1;
    }

    // Refresh the Onlook runtime asset before xcodebuild so the
    // OnlookMobileClient/Resources/onlook-runtime.js that Copy Bundle
    // Resources picks up matches packages/mobile-preview/runtime/bundle.js
    // (the source of truth). bundle-runtime.ts errors with a clear message
    // if bundle.js doesn't exist yet — in that case the caller needs to
    // `bun run build:mobile-runtime` first.
    const bundlePath = resolve(import.meta.dir, 'bundle-runtime.ts');
    console.log(`[run-build] bun run ${bundlePath}`);
    const bundleResult = spawnSync('bun', ['run', bundlePath], {
        stdio: 'inherit',
    });
    if (bundleResult.status !== 0) {
        return bundleResult.status ?? 1;
    }

    // MC1.4: bake the user JS bundle into the .app via `expo export:embed`
    // so the simulator build doesn't need a Metro server running. The
    // bridgeless RCTHost loads the bundle directly from the URL returned
    // by `bundleURL()` (see AppDelegate.swift), and that override prefers
    // the baked main.jsbundle over Metro when present. Without this step,
    // the smoke-test launch would deadlock waiting for Metro on
    // localhost:8081.
    //
    // The `--entry-file` argument needs an absolute path because Metro's
    // resolver runs from the monorepo root (`/Users/.../onlook/.`), not
    // from the workspace dir, and `./index.js` resolves to the wrong
    // location otherwise.
    const mobileClientRoot = resolve(import.meta.dir, '..');
    const bundleOutput = resolve(
        mobileClientRoot,
        'ios',
        'OnlookMobileClient',
        'Resources',
        'main.jsbundle',
    );
    const assetsDest = resolve(
        mobileClientRoot,
        'ios',
        'OnlookMobileClient',
        'Resources',
        'assets',
    );
    const entryFile = resolve(mobileClientRoot, 'index.js');
    console.log(`[run-build] bun x expo export:embed --bundle-output ${bundleOutput}`);
    const exportResult = spawnSync(
        'bun',
        [
            'x',
            'expo',
            'export:embed',
            '--platform',
            'ios',
            '--dev',
            'false',
            '--bundle-output',
            bundleOutput,
            '--assets-dest',
            assetsDest,
            '--entry-file',
            entryFile,
        ],
        { cwd: mobileClientRoot, stdio: 'inherit' },
    );
    if (exportResult.status !== 0) {
        return exportResult.status ?? 1;
    }

    const args = [
        '-workspace',
        WORKSPACE,
        '-scheme',
        SCHEME,
        '-configuration',
        'Debug',
        '-sdk',
        'iphonesimulator',
        '-destination',
        destination,
        'CODE_SIGNING_ALLOWED=NO',
        'build',
    ];
    console.log(`[run-build] (cwd=${iosDir}) xcodebuild ${args.join(' ')}`);
    const result = spawnSync('xcodebuild', args, {
        cwd: iosDir,
        stdio: 'inherit',
    });
    return result.status ?? 1;
}

process.exit(main());
