/**
 * Version SSOT drift test.
 *
 * `ONLOOK_RUNTIME_VERSION` in `packages/mobile-client-protocol/src/runtime-version.ts`
 * is the single source of truth for the mobile-client binary version (MC6.1).
 * Several downstream consumers embed or re-export that value:
 *
 *   1. `apps/mobile-client/src/version.ts` — `APP_VERSION` re-export.
 *   2. `apps/mobile-client/app.config.ts` — Expo `version` + `runtimeVersion`.
 *   3. `apps/mobile-client/scripts/generate-version-header.ts` — C++ header generator.
 *   4. `apps/cf-expo-relay/src/manifest-builder.ts` — manifest `onlookRuntimeVersion`.
 *   5. `apps/mobile-client/ios/OnlookMobileClient/Info.plist` — `CFBundleShortVersionString`.
 *
 * This test reads each consumer directly from disk (no module execution) and
 * asserts it either references the SSOT symbol by import OR literally equals
 * the SSOT string. A regression in any consumer trips a specific assertion so
 * the failure message points at the drifted file.
 */

import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { ONLOOK_RUNTIME_VERSION } from '../runtime-version';

// packages/mobile-client-protocol/src/__tests__ → repo root is 4 levels up.
const REPO_ROOT = resolve(import.meta.dir, '..', '..', '..', '..');

const VERSION_TS = join(REPO_ROOT, 'apps/mobile-client/src/version.ts');
const APP_CONFIG = join(REPO_ROOT, 'apps/mobile-client/app.config.ts');
const GEN_HEADER_SCRIPT = join(
    REPO_ROOT,
    'apps/mobile-client/scripts/generate-version-header.ts',
);
const MANIFEST_BUILDER = join(
    REPO_ROOT,
    'apps/cf-expo-relay/src/manifest-builder.ts',
);
const INFO_PLIST = join(
    REPO_ROOT,
    'apps/mobile-client/ios/OnlookMobileClient/Info.plist',
);

describe('version SSOT drift — consumers agree with ONLOOK_RUNTIME_VERSION', () => {
    test('SSOT is a valid semver string', () => {
        expect(ONLOOK_RUNTIME_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
    });

    test('apps/mobile-client/src/version.ts re-exports SSOT (APP_VERSION = ONLOOK_RUNTIME_VERSION)', () => {
        const src = readFileSync(VERSION_TS, 'utf8');
        // Must import the canonical constant from the protocol package.
        expect(src).toMatch(
            /import\s*\{[^}]*ONLOOK_RUNTIME_VERSION[^}]*\}\s*from\s*['"]@onlook\/mobile-client-protocol['"]/,
        );
        // APP_VERSION must be assigned directly from ONLOOK_RUNTIME_VERSION —
        // no inline literal that could drift.
        const appVersionMatch = /export\s+const\s+APP_VERSION\s*:\s*string\s*=\s*([^;]+);/.exec(
            src,
        );
        expect(appVersionMatch).not.toBeNull();
        expect(appVersionMatch![1]!.trim()).toBe('ONLOOK_RUNTIME_VERSION');
    });

    test('apps/mobile-client/app.config.ts version + runtimeVersion reference SSOT symbol', () => {
        const src = readFileSync(APP_CONFIG, 'utf8');
        expect(src).toMatch(
            /import\s*\{[^}]*ONLOOK_RUNTIME_VERSION[^}]*\}\s*from\s*['"]@onlook\/mobile-client-protocol['"]/,
        );
        // Both `version:` and `runtimeVersion:` must be assigned the symbol,
        // never a literal string that could go stale.
        expect(src).toMatch(/\bversion\s*:\s*ONLOOK_RUNTIME_VERSION\b/);
        expect(src).toMatch(/\bruntimeVersion\s*:\s*ONLOOK_RUNTIME_VERSION\b/);
    });

    test('apps/mobile-client/scripts/generate-version-header.ts imports SSOT from protocol', () => {
        const src = readFileSync(GEN_HEADER_SCRIPT, 'utf8');
        expect(src).toMatch(
            /import\s*\{[^}]*ONLOOK_RUNTIME_VERSION[^}]*\}\s*from\s*['"]@onlook\/mobile-client-protocol['"]/,
        );
    });

    test('apps/cf-expo-relay/src/manifest-builder.ts imports SSOT from protocol', () => {
        const src = readFileSync(MANIFEST_BUILDER, 'utf8');
        expect(src).toMatch(
            /import\s*\{[^}]*ONLOOK_RUNTIME_VERSION[^}]*\}\s*from\s*['"]@onlook\/mobile-client-protocol['"]/,
        );
        // Ensure the imported symbol is actually wired into the manifest (not
        // only imported) so a dead import doesn't silently let the value drift.
        expect(src).toMatch(/onlookRuntimeVersion\s*:\s*ONLOOK_RUNTIME_VERSION\b/);
    });

    test('Info.plist CFBundleShortVersionString equals SSOT', () => {
        const xml = readFileSync(INFO_PLIST, 'utf8');
        // Grep the key + following <string> value without a full XML parser.
        const match =
            /<key>CFBundleShortVersionString<\/key>\s*<string>([^<]+)<\/string>/.exec(
                xml,
            );
        expect(match).not.toBeNull();
        expect(match![1]).toBe(ONLOOK_RUNTIME_VERSION);
    });

    // The C++ header is generated on demand (.gitignored). Only assert when
    // it exists — running the generator here would couple this test to the
    // mobile-client workspace layout and its full dep graph.
    const GEN_HEADER_OUTPUT = join(
        REPO_ROOT,
        'apps/mobile-client/cpp/OnlookRuntime_version.generated.h',
    );
    test.skipIf(!existsSync(GEN_HEADER_OUTPUT))(
        'generated C++ header (if present) embeds SSOT',
        () => {
            const header = readFileSync(GEN_HEADER_OUTPUT, 'utf8');
            expect(header).toContain(
                `#define ONLOOK_RUNTIME_VERSION_STRING "${ONLOOK_RUNTIME_VERSION}"`,
            );
        },
    );
});
