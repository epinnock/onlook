import { expect, test, type Page } from '@playwright/test';
import { createServerClient } from '@supabase/ssr';

import { MOBILE_PREVIEW_FIXTURE_SDK_VERSION } from '../helpers/fixture';

const VERIFICATION_PROJECT_ID = '2bff33ae-7334-457e-a69e-93a5d90b18b3';
const MISMATCHED_RUNTIME_SDK_VERSION = '53.0.0';
const DEMO_USER_EMAIL = 'support@onlook.com';
const DEMO_USER_PASSWORD = 'password';
const LOCAL_SUPABASE_URL =
    process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() || 'http://127.0.0.1:54321';
const LOCAL_SUPABASE_ANON_KEY =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdWJhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0';

const TARGET_PROJECT_ID =
    process.env.ONLOOK_E2E_PROJECT_ID?.trim() || VERIFICATION_PROJECT_ID;

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
    const cookiesToSet: Array<{
        name: string;
        value: string;
        options?: {
            path?: string;
            httpOnly?: boolean;
            secure?: boolean;
            sameSite?: 'lax' | 'strict' | 'none';
            expires?: string | number | Date;
        };
    }> = [];

    const supabase = createServerClient(
        LOCAL_SUPABASE_URL,
        LOCAL_SUPABASE_ANON_KEY,
        {
            cookies: {
                getAll() {
                    return [];
                },
                setAll(nextCookies) {
                    cookiesToSet.splice(0, cookiesToSet.length, ...nextCookies);
                },
            },
        },
    );

    const { error } = await supabase.auth.signInWithPassword({
        email: DEMO_USER_EMAIL,
        password: DEMO_USER_PASSWORD,
    });
    if (error) {
        throw error;
    }

    await page.context().addCookies(
        cookiesToSet.map(({ name, value, options }) => ({
            name,
            value,
            url: getWebBaseUrl(),
            httpOnly: options?.httpOnly ?? false,
            secure: options?.secure ?? false,
            sameSite:
                options?.sameSite === 'strict'
                    ? 'Strict'
                    : options?.sameSite === 'none'
                      ? 'None'
                      : 'Lax',
            ...(options?.expires instanceof Date
                ? { expires: Math.floor(options.expires.getTime() / 1000) }
                : typeof options?.expires === 'number'
                  ? { expires: options.expires }
                  : {}),
        })),
    );
}

async function openExpoBrowserProject(page: Page): Promise<void> {
    const editorReady = page
        .locator('[data-testid="project-editor"], body[data-onlook-loaded="true"]')
        .first();
    const previewFrame = page
        .locator('iframe[id^="frame-"], iframe[src*="/preview/"]')
        .first();
    const previewButton = page.getByTestId('preview-on-device-button');

    await gotoAppPath(page, `/project/${TARGET_PROJECT_ID}`);

    if (page.url().includes('/see-a-demo')) {
        throw new Error(
            `Project ${TARGET_PROJECT_ID} redirected to /see-a-demo. Run the verification setup seed first.`,
        );
    }

    await editorReady.waitFor({ state: 'attached', timeout: 90_000 });
    await expect(previewButton).toBeVisible({ timeout: 30_000 });
    await previewFrame
        .waitFor({ state: 'attached', timeout: 30_000 })
        .catch(() => undefined);
    await page.waitForTimeout(1_000);
}

test.describe('Mobile preview SDK mismatch', () => {
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
