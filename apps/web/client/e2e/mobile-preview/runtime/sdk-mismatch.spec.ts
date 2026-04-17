import { expect, test, type Page } from '@playwright/test';

import { EXPO_BROWSER_TEST_BRANCH } from '../../fixtures/test-branch';
import { seedExpoBrowserTestBranch } from '../../expo-browser/helpers/setup';
import { MOBILE_PREVIEW_FIXTURE_SDK_VERSION } from '../helpers/fixture';

const MISMATCHED_RUNTIME_SDK_VERSION = '53.0.0';

const TARGET_PROJECT_ID =
    process.env.ONLOOK_E2E_PROJECT_ID?.trim() || EXPO_BROWSER_TEST_BRANCH.projectId;
const USER_GET_INPUT = encodeURIComponent(
    JSON.stringify({
        0: {
            json: null,
            meta: {
                values: ['undefined'],
                v: 1,
            },
        },
    }),
);

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getMobilePreviewStatusUrl(): string {
    const baseUrl =
        process.env.NEXT_PUBLIC_MOBILE_PREVIEW_URL?.trim() ||
        'http://127.0.0.1:8787';
    const url = new URL(baseUrl);
    url.pathname = '/status';
    url.search = '';
    url.hash = '';
    return url.toString();
}

function getWebBaseUrl(): string {
    const explicitBaseUrl = process.env.PLAYWRIGHT_BASE_URL?.trim();
    if (explicitBaseUrl) {
        return new URL(explicitBaseUrl).toString();
    }

    const explicitPort =
        process.env.PLAYWRIGHT_PORT?.trim() || process.env.PORT?.trim() || '3000';
    return `http://127.0.0.1:${explicitPort}`;
}

function resolveAppUrl(pathname: string): string {
    return new URL(pathname, getWebBaseUrl()).toString();
}

async function waitForAuthenticatedSession(page: Page): Promise<void> {
    const userGetUrl = resolveAppUrl(`/api/trpc/user.get?batch=1&input=${USER_GET_INPUT}`);

    for (let attempt = 0; attempt < 60; attempt += 1) {
        const cookies = await page.context().cookies([getWebBaseUrl()]);
        const hasAuthCookie = cookies.some(
            (cookie) => cookie.name.includes('auth-token') && cookie.value.length > 0,
        );

        if (!hasAuthCookie) {
            await page.waitForTimeout(500);
            continue;
        }

        const response = await page.context().request.get(userGetUrl).catch(() => null);
        if (!response) {
            await page.waitForTimeout(500);
            continue;
        }

        const body = await response.text();
        if (
            response.ok() &&
            body.includes('"result"') &&
            !body.includes('"error"') &&
            !body.includes('Auth session missing!')
        ) {
            return;
        }

        await page.waitForTimeout(500);
    }

    throw new Error('Timed out waiting for an authenticated dev-login session.');
}

async function gotoAppPath(page: Page, pathname: string): Promise<void> {
    try {
        await page.goto(resolveAppUrl(pathname), {
            timeout: 120_000,
            waitUntil: 'domcontentloaded',
        });
    } catch (error) {
        if (
            !(
                error instanceof Error &&
                (error.message.includes('ERR_ABORTED') ||
                    error.message.includes('frame was detached'))
            )
        ) {
            throw error;
        }

        await page
            .waitForLoadState('domcontentloaded', { timeout: 30_000 })
            .catch(() => undefined);
    }
}

async function signInAsDemoUser(page: Page): Promise<void> {
    const returnUrl = encodeURIComponent(`/project/${TARGET_PROJECT_ID}`);
    await gotoAppPath(page, `/auth/dev-login?returnUrl=${returnUrl}`);
    await waitForAuthenticatedSession(page);
}

async function gotoProjectPage(page: Page): Promise<void> {
    await gotoAppPath(page, `/project/${TARGET_PROJECT_ID}`);
}

async function openExpoBrowserProject(page: Page): Promise<void> {
    const previewFrame = page
        .locator('iframe[id^="frame-"], iframe[src*="/preview/"]')
        .first();
    const previewButton = page.getByTestId('preview-on-device-button');
    const loadingProject = page.getByText('Loading project...');
    const applicationErrorHeading = page
        .getByRole('heading', {
            name: /application error: a client-side exception has occurred/i,
        })
        .first();

    await gotoProjectPage(page);

    if (page.url().includes('/login')) {
        await signInAsDemoUser(page);
        await gotoProjectPage(page);
    }

    if (page.url().includes('/see-a-demo')) {
        throw new Error(
            `Project ${TARGET_PROJECT_ID} redirected to /see-a-demo. Run the verification setup seed first.`,
        );
    }

    await loadingProject
        .waitFor({ state: 'hidden', timeout: 120_000 })
        .catch(() => undefined);

    if (
        await applicationErrorHeading
            .isVisible({ timeout: 2_000 })
            .catch(() => false)
    ) {
        throw new Error('Project route rendered a client-side application error.');
    }

    await expect(previewButton).toBeVisible({ timeout: 60_000 });
    await previewFrame
        .waitFor({ state: 'attached', timeout: 30_000 })
        .catch(() => undefined);
    await page.waitForTimeout(1_000);
}

test.describe('Mobile preview SDK mismatch', () => {
    test.beforeAll(() => {
        seedExpoBrowserTestBranch();
    });

    test('preview open fails with a clear Expo SDK mismatch error', async ({
        page,
    }) => {
        test.setTimeout(180_000);

        const statusUrl = getMobilePreviewStatusUrl();
        const expectedMismatchMessage = `Mobile preview runtime uses Expo SDK ${MISMATCHED_RUNTIME_SDK_VERSION}, but this project depends on Expo SDK ${MOBILE_PREVIEW_FIXTURE_SDK_VERSION}.`;

        await page.route(new RegExp(`^${escapeRegExp(statusUrl)}$`), async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    runtimeHash: 'runtime-hash-sdk-mismatch',
                    clients: 0,
                    manifestUrl: 'exp://preview.test/manifest/runtime-hash-sdk-mismatch',
                    runtimeSdkVersion: MISMATCHED_RUNTIME_SDK_VERSION,
                }),
            });
        });

        await signInAsDemoUser(page);
        await openExpoBrowserProject(page);

        await page.getByTestId('preview-on-device-button').click();

        const errorState = page.getByTestId('qr-status-error');
        await expect(errorState).toBeVisible();
        await expect(errorState).toContainText(expectedMismatchMessage);
        await expect(page.getByTestId('qr-retry-btn')).toBeVisible();
    });
});
