/**
 * binary-size-audit.sh.test.ts — MCI.2
 *
 * Runs the bash script against a synthetic .app fixture and asserts the
 * JSON-on-stdout shape. Does NOT require a Mac mini, Xcode, or a real build
 * — we fabricate a minimal directory tree that looks like the .app bundle
 * from the script's perspective (main binary + onlook-runtime.js +
 * main.jsbundle + Frameworks/).
 *
 * The script itself is platform-neutral (pure bash + POSIX-y tools); it
 * auto-detects BSD vs GNU `stat` at runtime. We exercise whichever branch
 * the test host provides.
 */
import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT = resolve(HERE, '..', 'binary-size-audit.sh');

type Component = {
    path: string;
    bytes: number;
    human: string;
    present: boolean;
};

type TopFile = {
    bytes: number;
    human: string;
    relPath: string;
};

type AuditJson = {
    schemaVersion: number;
    generatedAt: string;
    appPath: string;
    appName: string;
    total: { bytes: number; human: string };
    components: {
        mainBinary: Component;
        onlookRuntime: Component;
        mainJsBundle: Component;
        frameworks: Component;
    };
    top10Files: TopFile[];
};

let tmpRoot: string;
let appPath: string;

function writeBytes(path: string, size: number): void {
    // Deterministic byte content so sha-by-size stays predictable.
    const buf = Buffer.alloc(size, 0x61); // 'a' repeated
    writeFileSync(path, buf);
}

beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'binary-size-audit-test-'));
    appPath = join(tmpRoot, 'Fixture.app');
    mkdirSync(join(appPath, 'Frameworks', 'hermes.framework'), { recursive: true });
    mkdirSync(join(appPath, 'Resources'), { recursive: true });
    // Fake main binary ~64 KB
    writeBytes(join(appPath, 'OnlookMobileClient'), 64 * 1024);
    // Fake hermes in Frameworks ~128 KB (so it wins top-10 #1)
    writeBytes(join(appPath, 'Frameworks', 'hermes.framework', 'hermes'), 128 * 1024);
    // Fake onlook-runtime.js ~4 KB
    writeBytes(join(appPath, 'onlook-runtime.js'), 4 * 1024);
    // Fake main.jsbundle ~96 KB
    writeBytes(join(appPath, 'main.jsbundle'), 96 * 1024);
    // Small Info.plist
    writeFileSync(join(appPath, 'Info.plist'), '<plist />');
});

afterEach(() => {
    rmSync(tmpRoot, { recursive: true, force: true });
});

function runScript(args: string[]): { stdout: string; stderr: string; status: number } {
    const result = spawnSync('bash', [SCRIPT, ...args], {
        encoding: 'utf8',
        timeout: 30_000,
    });
    return {
        stdout: result.stdout ?? '',
        stderr: result.stderr ?? '',
        status: result.status ?? -1,
    };
}

describe('binary-size-audit.sh', () => {
    test('exits 0 and emits valid JSON for a fixture .app', () => {
        const { stdout, status } = runScript(['--app', appPath]);
        expect(status).toBe(0);
        expect(() => JSON.parse(stdout) as AuditJson).not.toThrow();
    });

    test('JSON has the documented top-level schema', () => {
        const { stdout } = runScript(['--app', appPath]);
        const j = JSON.parse(stdout) as AuditJson;
        expect(j.schemaVersion).toBe(1);
        expect(typeof j.generatedAt).toBe('string');
        expect(j.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
        expect(j.appPath).toBe(appPath);
        expect(j.appName).toBe('Fixture.app');
        expect(typeof j.total.bytes).toBe('number');
        expect(typeof j.total.human).toBe('string');
        expect(j.total.bytes).toBeGreaterThan(0);
    });

    test('all four key components are detected with correct paths', () => {
        const { stdout } = runScript(['--app', appPath]);
        const j = JSON.parse(stdout) as AuditJson;
        expect(j.components.mainBinary.path).toBe('OnlookMobileClient');
        expect(j.components.mainBinary.present).toBe(true);
        expect(j.components.mainBinary.bytes).toBe(64 * 1024);

        expect(j.components.onlookRuntime.path).toBe('onlook-runtime.js');
        expect(j.components.onlookRuntime.present).toBe(true);
        expect(j.components.onlookRuntime.bytes).toBe(4 * 1024);

        expect(j.components.mainJsBundle.path).toBe('main.jsbundle');
        expect(j.components.mainJsBundle.present).toBe(true);
        expect(j.components.mainJsBundle.bytes).toBe(96 * 1024);

        expect(j.components.frameworks.path).toBe('Frameworks');
        expect(j.components.frameworks.present).toBe(true);
        expect(j.components.frameworks.bytes).toBe(128 * 1024);
    });

    test('top10Files is sorted descending by bytes and includes biggest item', () => {
        const { stdout } = runScript(['--app', appPath]);
        const j = JSON.parse(stdout) as AuditJson;
        expect(Array.isArray(j.top10Files)).toBe(true);
        expect(j.top10Files.length).toBeGreaterThan(0);
        expect(j.top10Files.length).toBeLessThanOrEqual(10);
        // Descending by bytes
        for (let i = 1; i < j.top10Files.length; i++) {
            expect(j.top10Files[i - 1]!.bytes).toBeGreaterThanOrEqual(j.top10Files[i]!.bytes);
        }
        // Biggest fixture file is hermes (128 KB)
        expect(j.top10Files[0]!.relPath).toBe('Frameworks/hermes.framework/hermes');
        expect(j.top10Files[0]!.bytes).toBe(128 * 1024);
    });

    test('marks missing components as present:false with 0 bytes', () => {
        // Remove onlook-runtime.js + main.jsbundle to exercise the "missing" branch.
        rmSync(join(appPath, 'onlook-runtime.js'));
        rmSync(join(appPath, 'main.jsbundle'));
        const { stdout } = runScript(['--app', appPath]);
        const j = JSON.parse(stdout) as AuditJson;
        expect(j.components.onlookRuntime.present).toBe(false);
        expect(j.components.onlookRuntime.bytes).toBe(0);
        expect(j.components.mainJsBundle.present).toBe(false);
        expect(j.components.mainJsBundle.bytes).toBe(0);
        // mainBinary + Frameworks still present
        expect(j.components.mainBinary.present).toBe(true);
        expect(j.components.frameworks.present).toBe(true);
    });

    test('emits human-readable summary on stderr', () => {
        const { stderr, status } = runScript(['--app', appPath]);
        expect(status).toBe(0);
        expect(stderr).toContain('[binary-size-audit]');
        expect(stderr).toContain('total');
        expect(stderr).toContain('components');
        expect(stderr).toContain('top 10 files by size');
    });

    test('exits 2 when --app points nowhere and DerivedData has no match', () => {
        const { status, stderr } = runScript(['--app', '/nonexistent/path.app']);
        expect(status).toBe(2);
        expect(stderr).toContain('no .app found');
    });

    test('supports --app=PATH form as well as --app PATH', () => {
        const { stdout, status } = runScript([`--app=${appPath}`]);
        expect(status).toBe(0);
        const j = JSON.parse(stdout) as AuditJson;
        expect(j.appPath).toBe(appPath);
    });
});
