import { describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const REPO_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');
const SCRIPT = join(REPO_ROOT, 'apps', 'mobile-client', 'scripts', 'install-device.ts');

interface RunResult {
    status: number | null;
    stdout: string;
    stderr: string;
}

interface RunOptions {
    env?: Record<string, string | undefined>;
    /** When provided, these args are passed to the script. */
    args?: string[];
}

// Mirror of validate-task.test.ts's workaround: bun:test on macOS arm64
// (Bun 1.3.9+) returns empty strings for child stdio pipes from workspace
// package test files. File-descriptor redirects are unaffected, so we
// capture via `sh -c` with redirection. Works on Linux/macOS identically.
function runInstallDevice(options: RunOptions = {}): RunResult {
    const tmp = mkdtempSync(join(tmpdir(), 'install-device-test-'));
    const outPath = join(tmp, 'stdout');
    const errPath = join(tmp, 'stderr');
    const args = options.args ?? [];
    const quoted = args
        .map((a) => `'${a.replace(/'/g, `'\\''`)}'`)
        .join(' ');
    const cmd = `bun run "${SCRIPT}" ${quoted} >"${outPath}" 2>"${errPath}"`;

    // Build a fresh env so we do not accidentally inherit
    // ONLOOK_DEVICE_UDID from the test runner shell.
    const baseEnv: Record<string, string> = {};
    for (const [key, value] of Object.entries(process.env)) {
        if (value !== undefined) baseEnv[key] = value;
    }
    delete baseEnv.ONLOOK_DEVICE_UDID;

    if (options.env) {
        for (const [key, value] of Object.entries(options.env)) {
            if (value === undefined) {
                delete baseEnv[key];
            } else {
                baseEnv[key] = value;
            }
        }
    }

    const result = spawnSync('sh', ['-c', cmd], {
        cwd: REPO_ROOT,
        env: baseEnv,
    });
    const stdout = readFileSync(outPath, 'utf8');
    const stderr = readFileSync(errPath, 'utf8');
    rmSync(tmp, { recursive: true, force: true });
    return { status: result.status, stdout, stderr };
}

/**
 * Create a temp dir containing an executable `ios-deploy` stub that exits
 * successfully for `--version`. Returned path is suitable for prepending to
 * PATH so the script's probe resolves the stub instead of a real binary.
 */
function makeFakeIosDeployBinDir(): string {
    const binDir = mkdtempSync(join(tmpdir(), 'install-device-fake-bin-'));
    const stubPath = join(binDir, 'ios-deploy');
    writeFileSync(stubPath, '#!/bin/sh\nexit 0\n', 'utf8');
    chmodSync(stubPath, 0o755);
    return binDir;
}

/**
 * Create a temp dir containing an `ios-deploy` stub that emits the
 * canonical "Found <udid> ..." line that the auto-detect parser keys on.
 * Used by the auto-detect tests to inject 0 / 1 / N detected devices
 * without depending on real USB hardware. The stub also accepts
 * `--version` (for the upstream probe) and `-i ... --bundle ... --justlaunch`
 * (the install path); these branches return immediately so the test never
 * actually reaches a real install.
 */
function makeFakeIosDeployBinDirWithDevices(udids: readonly string[]): string {
    const binDir = mkdtempSync(join(tmpdir(), 'install-device-fake-detect-'));
    const stubPath = join(binDir, 'ios-deploy');
    const foundLines = udids
        .map(
            (u) =>
                `echo "[....] Found ${u} (D211AP, iPhone 8 Plus, iphoneos, arm64, 15.1, 19B74) a.k.a. 'Test iPhone' connected through USB."`,
        )
        .join('\n');
    const script = `#!/bin/sh
case "$1" in
  --version) exit 0 ;;
  --detect)
${foundLines || ':'}
    exit 0
    ;;
  *) exit 0 ;;
esac
`;
    writeFileSync(stubPath, script, 'utf8');
    chmodSync(stubPath, 0o755);
    return binDir;
}

/**
 * Build a sanitized PATH that:
 *   - includes the dir containing the running `bun` binary (so `sh -c "bun
 *     run ..."` can still resolve bun), and
 *   - excludes the common ios-deploy install locations (Homebrew
 *     `/opt/homebrew/bin`, `/usr/local/bin`, plus any MacPorts prefix).
 * This makes iosDeployOnPath() return false deterministically, even on a
 * dev machine that has ios-deploy installed. Tests that want the probe to
 * succeed prepend a fake-ios-deploy stub dir onto this value.
 */
function sanitizedPath(): string {
    const bunDir = dirname(process.execPath);
    // /usr/bin and /bin are needed for sh itself plus general shell builtins
    // (`command -v`, etc.) that ios-deploy's absence test does not rely on
    // but which bun's own startup can touch.
    return `${bunDir}:/usr/bin:/bin`;
}

describe('install-device.ts', () => {
    test('exits 2 when no UDID is supplied (flag absent, env unset)', () => {
        const result = runInstallDevice({ env: { PATH: sanitizedPath() } });
        expect(result.status).toBe(2);
        expect(result.stderr).toMatch(/Missing device UDID/);
        expect(result.stderr).toMatch(/--device/);
        expect(result.stderr).toMatch(/ONLOOK_DEVICE_UDID/);
    });

    test('exits 127 with brew hint when ios-deploy is not on PATH', () => {
        const result = runInstallDevice({
            args: ['--device=FAKE-UDID-127'],
            env: { PATH: sanitizedPath() },
        });
        expect(result.status).toBe(127);
        expect(result.stderr).toMatch(/ios-deploy/);
        expect(result.stderr).toMatch(/brew install ios-deploy/);
    });

    test('exits 3 with mobile:build:ios hint when no .app bundle is found', () => {
        // Provide a fake ios-deploy so the probe passes, then point HOME at
        // an empty dir so ~/Library/Developer/Xcode/DerivedData/... resolves
        // to nothing. The package-local ./build/ tree also does not exist
        // in CI/dev checkouts.
        const fakeBin = makeFakeIosDeployBinDir();
        const emptyHome = mkdtempSync(join(tmpdir(), 'install-device-empty-home-'));
        try {
            const result = runInstallDevice({
                args: ['--device=FAKE-UDID-3'],
                env: {
                    PATH: `${fakeBin}:${sanitizedPath()}`,
                    HOME: emptyHome,
                },
            });
            expect(result.status).toBe(3);
            expect(result.stderr).toMatch(/OnlookMobileClient\.app/);
            expect(result.stderr).toMatch(/mobile:build:ios/);
        } finally {
            rmSync(fakeBin, { recursive: true, force: true });
            rmSync(emptyHome, { recursive: true, force: true });
        }
    });

    test('accepts --device=UDID flag form (parser reaches ios-deploy probe)', () => {
        // If UDID parsing fails we'd see exit 2. A 127 exit here proves the
        // UDID was accepted and we advanced past parseDeviceUdid into the
        // ios-deploy check.
        const result = runInstallDevice({
            args: ['--device=PARSE-EQ-FORM'],
            env: { PATH: sanitizedPath() },
        });
        expect(result.status).toBe(127);
        expect(result.stderr).not.toMatch(/Missing device UDID/);
    });

    test('does NOT support space-separated `--device UDID` form', () => {
        // The current parser in install-device.ts only recognizes
        // `--device=<UDID>` (see parseDeviceUdid: argv.find(a =>
        // a.startsWith('--device='))). The space-separated form is not
        // documented in the script's Usage block either. This test pins the
        // current behavior so future changes are intentional: if someone
        // adds space-form support they'll flip this expectation.
        const result = runInstallDevice({
            args: ['--device', 'SPACE-FORM-UDID'],
            env: { PATH: sanitizedPath() },
        });
        expect(result.status).toBe(2);
        expect(result.stderr).toMatch(/Missing device UDID/);
    });

    test('falls back to ONLOOK_DEVICE_UDID env var when flag is absent', () => {
        const result = runInstallDevice({
            env: {
                PATH: sanitizedPath(),
                ONLOOK_DEVICE_UDID: 'ENV-UDID-42',
            },
        });
        // Reaching the ios-deploy probe (exit 127) means the env var was
        // read successfully.
        expect(result.status).toBe(127);
        expect(result.stderr).not.toMatch(/Missing device UDID/);
        expect(result.stderr).toMatch(/brew install ios-deploy/);
    });

    test('prefers --device= flag over ONLOOK_DEVICE_UDID env var (both pass through)', () => {
        // Both sources yield a UDID, so either way we should reach the
        // ios-deploy probe and exit 127. This guards against a regression
        // where setting the env var accidentally short-circuits flag
        // parsing.
        const result = runInstallDevice({
            args: ['--device=FLAG-WINS'],
            env: {
                PATH: sanitizedPath(),
                ONLOOK_DEVICE_UDID: 'ENV-LOSES',
            },
        });
        expect(result.status).toBe(127);
        expect(result.stderr).not.toMatch(/Missing device UDID/);
    });

    test('auto-detect: single connected iPhone is picked up when no UDID is supplied', () => {
        // No --device flag, no env var, but ios-deploy stub reports exactly
        // one device. The script should auto-pick that UDID and proceed
        // past the missing-UDID error to the .app-bundle lookup. The empty
        // HOME forces the bundle lookup to fail with exit 3, which proves
        // we cleared the udid-resolution stage successfully.
        const detectedUdid = '2f2b1f290e974ea4e5be913d2387cffb6e6ae834';
        const fakeBin = makeFakeIosDeployBinDirWithDevices([detectedUdid]);
        const emptyHome = mkdtempSync(join(tmpdir(), 'install-device-empty-home-'));
        try {
            const result = runInstallDevice({
                env: {
                    PATH: `${fakeBin}:${sanitizedPath()}`,
                    HOME: emptyHome,
                },
            });
            expect(result.status).toBe(3);
            expect(result.stdout).toMatch(new RegExp(`auto-detected device ${detectedUdid}`));
            expect(result.stderr).not.toMatch(/Missing device UDID/);
        } finally {
            rmSync(fakeBin, { recursive: true, force: true });
            rmSync(emptyHome, { recursive: true, force: true });
        }
    });

    test('auto-detect: refuses to auto-pick when multiple iPhones are connected', () => {
        const fakeBin = makeFakeIosDeployBinDirWithDevices([
            'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
            'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
        ]);
        try {
            const result = runInstallDevice({
                env: { PATH: `${fakeBin}:${sanitizedPath()}` },
            });
            expect(result.status).toBe(2);
            expect(result.stderr).toMatch(/Multiple iPhones connected/);
            expect(result.stderr).toMatch(/aaaaaaaa/);
            expect(result.stderr).toMatch(/bbbbbbbb/);
        } finally {
            rmSync(fakeBin, { recursive: true, force: true });
        }
    });

    test('auto-detect: zero connected iPhones falls through to missing-UDID error', () => {
        const fakeBin = makeFakeIosDeployBinDirWithDevices([]);
        try {
            const result = runInstallDevice({
                env: { PATH: `${fakeBin}:${sanitizedPath()}` },
            });
            expect(result.status).toBe(2);
            expect(result.stderr).toMatch(/Missing device UDID/);
            // The error path should NOT mention the multiple-devices branch
            // when zero are connected.
            expect(result.stderr).not.toMatch(/Multiple iPhones connected/);
        } finally {
            rmSync(fakeBin, { recursive: true, force: true });
        }
    });
});
