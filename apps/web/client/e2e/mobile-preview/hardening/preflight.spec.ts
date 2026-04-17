import { existsSync } from 'node:fs';
import path from 'node:path';

import { expect, test, type Locator, type Page } from '@playwright/test';

import { seedExpoBrowserTestBranch } from '../../expo-browser/helpers/setup';
import { EXPO_BROWSER_TEST_BRANCH } from '../../fixtures/test-branch';
import {
    ensureDevLoggedIn,
    openVerificationProject as openSharedVerificationProject,
    seedVerificationFixture,
    VERIFICATION_BRANCH_ID,
    VERIFICATION_PROJECT_ID,
} from '../helpers/browser';
import { MOBILE_PREVIEW_FIXTURE_SDK_VERSION } from '../helpers/fixture';

const TARGET_PROJECT_ID = EXPO_BROWSER_TEST_BRANCH.projectId;
const TARGET_BRANCH_ID = EXPO_BROWSER_TEST_BRANCH.branchId;
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

function seedAppOverride(repoRoot: string, appSource: string): void {
    seedVerificationFixture(
        repoRoot,
        { 'App.tsx': appSource },
        TARGET_PROJECT_ID,
        TARGET_BRANCH_ID,
    );
}

function restoreTargetFixture(repoRoot: string): void {
    seedVerificationFixture(repoRoot, {}, TARGET_PROJECT_ID, TARGET_BRANCH_ID);
}

function restoreSharedVerificationFixture(repoRoot: string): void {
    seedVerificationFixture(
        repoRoot,
        {},
        VERIFICATION_PROJECT_ID,
        VERIFICATION_BRANCH_ID,
    );
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
    const previewButton = page.getByTestId('preview-on-device-button');

    await openSharedVerificationProject(page, TARGET_PROJECT_ID);
    await expect(previewButton).toBeVisible({ timeout: 60_000 });
}

async function triggerMobilePreviewBundlePush(page: Page): Promise<void> {
    await page.evaluate(() => {
        const channel = new BroadcastChannel('onlook-preview');
        channel.postMessage({ type: 'bundle' });
        channel.close();
    });
}

async function expectPreflightFailure(
    page: Page,
    expectedMessage: RegExp,
): Promise<Locator> {
    await page.getByTestId('preview-on-device-button').click();

    const modalError = page.getByTestId('qr-status-error');
    const errorPanel = page.getByTestId('mobile-preview-error-panel');
    await triggerMobilePreviewBundlePush(page);

    if (await modalError.isVisible({ timeout: 500 }).catch(() => false)) {
        await expect(modalError).toContainText(expectedMessage);
        await expect(modalError).toContainText(/Failed to sync app to phone:/);
        return modalError;
    }

    await expect(errorPanel).toBeVisible({ timeout: 30_000 });
    await expect(errorPanel).toContainText(/Sync error/);
    await expect(errorPanel).toContainText(expectedMessage);
    return errorPanel;
}

test.describe.serial('Mobile preview preflight failures', () => {
    let repoRoot: string;

    test.beforeAll(() => {
        repoRoot = resolveRepoRoot();
        seedExpoBrowserTestBranch();
        restoreTargetFixture(repoRoot);
        restoreSharedVerificationFixture(repoRoot);
    });

    test.afterEach(() => {
        restoreTargetFixture(repoRoot);
        restoreSharedVerificationFixture(repoRoot);
    });

    test.afterAll(() => {
        restoreTargetFixture(repoRoot);
        restoreSharedVerificationFixture(repoRoot);
    });

    test('surfaces unsupported package imports with an explicit preflight error', async ({
        page,
    }) => {
        test.setTimeout(180_000);

        seedAppOverride(repoRoot, UNSUPPORTED_IMPORT_APP_TSX);
        await stubMobilePreviewStatus(page);
        await ensureDevLoggedIn(page, `/project/${TARGET_PROJECT_ID}`);
        await openVerificationProject(page);

        const errorSurface = await expectPreflightFailure(
            page,
            /Mobile preview does not support these package imports yet:/,
        );
        await expect(errorSurface).toContainText(/react-native-mmkv/);
        await expect(errorSurface).toContainText(/App\.tsx/);
    });

    test('surfaces bundle hard-limit failures with an explicit budget error', async ({
        page,
    }) => {
        test.setTimeout(180_000);

        seedAppOverride(repoRoot, HARD_LIMIT_APP_TSX);
        await stubMobilePreviewStatus(page);
        await ensureDevLoggedIn(page, `/project/${TARGET_PROJECT_ID}`);
        await openVerificationProject(page);

        const errorSurface = await expectPreflightFailure(page, /hard limit of 2 MB/);
        await expect(errorSurface).toContainText(
            /Reduce the bundle size before pushing to a device\./,
        );
    });
});
