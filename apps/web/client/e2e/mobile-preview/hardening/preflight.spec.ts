import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Page } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';

import { MOBILE_PREVIEW_FIXTURE_SDK_VERSION } from '../helpers/fixture';

const LOCAL_SUPABASE_URL = 'http://127.0.0.1:54321';
const LOCAL_SUPABASE_SERVICE_KEY =
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU';
const EXPO_PROJECT_STORAGE_BUCKET = 'expo-projects';

const VERIFICATION_PROJECT_ID = '2bff33ae-7334-457e-a69e-93a5d90b18b3';
const VERIFICATION_BRANCH_ID = 'fcebdee5-1010-4147-9748-823a27dc36a3';

const PLAYWRIGHT_APP_BASE_URL =
    process.env.PLAYWRIGHT_BASE_URL?.trim() || 'http://127.0.0.1:3000';
const MOBILE_PREVIEW_SERVER_BASE_URL =
    process.env.NEXT_PUBLIC_MOBILE_PREVIEW_URL?.trim() || 'http://127.0.0.1:8787';

const UNSUPPORTED_IMPORT_APP_TSX = `import { MMKV } from 'react-native-mmkv';

const storage = new MMKV();

export default function App() {
  return storage ? null : null;
}
`;

const BUNDLE_LIMIT_FILLER = 'x'.repeat(2 * 1024 * 1024 + 512);
const HARD_LIMIT_APP_TSX = `const filler = ${JSON.stringify(BUNDLE_LIMIT_FILLER)};

export default function App() {
  return filler;
}
`;

function resolveRepoRoot(): string {
    const cwd = process.cwd();
    const rootFromCwd = path.join(
        cwd,
        'apps/web/client/verification/onlook-editor/setup.sh',
    );

    if (existsSync(rootFromCwd)) {
        return cwd;
    }

    const rootFromApp = path.resolve(cwd, '../../..');
    if (
        existsSync(
            path.join(
                rootFromApp,
                'apps/web/client/verification/onlook-editor/setup.sh',
            ),
        )
    ) {
        return rootFromApp;
    }

    throw new Error(`Unable to resolve repo root from cwd: ${cwd}`);
}

function buildStorageKey(filePath: string): string {
    const normalizedPath = filePath.replace(/^\/+/, '').replace(/^\.\//, '');
    return `${VERIFICATION_PROJECT_ID}/${VERIFICATION_BRANCH_ID}/${normalizedPath}`;
}

function buildAppUrl(pathname: string): string {
    return new URL(pathname, PLAYWRIGHT_APP_BASE_URL).toString();
}

function buildMobilePreviewStatusUrl(): string {
    const url = new URL(MOBILE_PREVIEW_SERVER_BASE_URL);
    url.pathname = '/status';
    url.search = '';
    url.hash = '';
    return url.toString();
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function runVerificationSetup(repoRoot: string): void {
    const setupScriptPath = path.join(
        repoRoot,
        'apps/web/client/verification/onlook-editor/setup.sh',
    );

    try {
        execFileSync('bash', [setupScriptPath], {
            cwd: repoRoot,
            encoding: 'utf8',
            stdio: 'pipe',
            timeout: 300_000,
        });
    } catch (error) {
        const stdout =
            error && typeof error === 'object' && 'stdout' in error
                ? String(error.stdout)
                : '';
        const stderr =
            error && typeof error === 'object' && 'stderr' in error
                ? String(error.stderr)
                : '';

        throw new Error(
            `verification setup failed.\nstdout:\n${stdout}\nstderr:\n${stderr}`,
        );
    }
}

async function uploadAppOverride(appSource: string): Promise<void> {
    const supabase = createClient(LOCAL_SUPABASE_URL, LOCAL_SUPABASE_SERVICE_KEY, {
        auth: {
            autoRefreshToken: false,
            persistSession: false,
        },
    });

    const { error } = await supabase.storage
        .from(EXPO_PROJECT_STORAGE_BUCKET)
        .upload(buildStorageKey('App.tsx'), appSource, {
            upsert: true,
            contentType: 'text/plain; charset=utf-8',
        });

    if (error) {
        throw new Error(`failed to upload App.tsx override: ${error.message}`);
    }
}

async function ensureLoggedIn(page: Page): Promise<void> {
    const response = await page.goto(buildAppUrl('/login'));
    if (response && response.status() >= 500) {
        throw new Error(
            `login page returned ${response.status()} at ${response.url()}`,
        );
    }

    const devLoginButton = page.getByRole('button', {
        name: /dev mode: sign in as demo user/i,
    });

    if (await devLoginButton.isVisible().catch(() => false)) {
        await devLoginButton.click();
    }

    await page.waitForURL((url) => !url.pathname.startsWith('/login'), {
        timeout: 60_000,
    });
}

async function installDelayedInitialPush(page: Page): Promise<void> {
    await page.addInitScript(() => {
        const originalSetTimeout = globalThis.setTimeout.bind(globalThis);

        Object.defineProperty(globalThis, '__mobilePreviewOriginalSetTimeout', {
            value: originalSetTimeout,
            configurable: true,
        });

        globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: unknown[]) => {
            const nextTimeout =
                timeout === 150 ? 2_000 : timeout;
            return originalSetTimeout(handler, nextTimeout, ...args);
        }) as typeof globalThis.setTimeout;
    });
}

async function stubMobilePreviewStatus(page: Page): Promise<void> {
    const statusUrl = buildMobilePreviewStatusUrl();

    await page.route(new RegExp(`^${escapeRegExp(statusUrl)}$`), async (route) => {
        await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
                runtimeHash: 'runtime-hash-preflight-e2e',
                clients: 0,
                manifestUrl: 'exp://preview.test/manifest/runtime-hash-preflight-e2e',
                runtimeSdkVersion: MOBILE_PREVIEW_FIXTURE_SDK_VERSION,
            }),
        });
    });
}

async function openVerificationProject(page: Page): Promise<void> {
    const editor = page
        .locator('[data-testid="project-editor"], body[data-onlook-loaded="true"]')
        .first();
    const previewButton = page.getByTestId('preview-on-device-button');

    await page.goto(buildAppUrl(`/project/${VERIFICATION_PROJECT_ID}`), {
        waitUntil: 'domcontentloaded',
    });

    await editor.waitFor({ state: 'attached', timeout: 60_000 });
    await expect(previewButton).toBeVisible({ timeout: 60_000 });
}

async function expectPreflightFailure(
    page: Page,
    expectedMessage: RegExp,
): Promise<void> {
    await page.getByTestId('preview-on-device-button').click();

    const errorState = page.getByTestId('qr-status-error');
    await expect(errorState).toBeVisible({ timeout: 20_000 });
    await expect(errorState).toContainText(expectedMessage);
    await expect(errorState).toContainText(/Failed to sync app to phone:/);
}

test.describe.serial('Mobile preview preflight failures', () => {
    test.beforeAll(async () => {
        runVerificationSetup(resolveRepoRoot());
    });

    test('surfaces unsupported package imports with an explicit preflight error', async ({
        page,
    }) => {
        test.setTimeout(180_000);

        await uploadAppOverride(UNSUPPORTED_IMPORT_APP_TSX);
        await installDelayedInitialPush(page);
        await stubMobilePreviewStatus(page);
        await ensureLoggedIn(page);
        await openVerificationProject(page);

        await expectPreflightFailure(
            page,
            /Mobile preview does not support these package imports yet:/,
        );
        await expect(page.getByTestId('qr-status-error')).toContainText(
            /react-native-mmkv/,
        );
        await expect(page.getByTestId('qr-status-error')).toContainText(
            /App\.tsx/,
        );
    });

    test('surfaces bundle hard-limit failures with an explicit budget error', async ({
        page,
    }) => {
        test.setTimeout(180_000);

        await uploadAppOverride(HARD_LIMIT_APP_TSX);
        await installDelayedInitialPush(page);
        await stubMobilePreviewStatus(page);
        await ensureLoggedIn(page);
        await openVerificationProject(page);

        await expectPreflightFailure(page, /hard limit of 2 MB/);
        await expect(page.getByTestId('qr-status-error')).toContainText(
            /Reduce the bundle size before pushing to a device\./,
        );
    });
});
