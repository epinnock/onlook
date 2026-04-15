import { expect, test, type Page } from '@playwright/test';

import { EXPO_BROWSER_TEST_BRANCH } from '../../fixtures/test-branch';
import {
    MOBILE_PREVIEW_FIXTURE_PROJECT_ID,
    MOBILE_PREVIEW_FIXTURE_SDK_VERSION,
} from '../helpers/fixture';

const VERIFICATION_PROJECT_ID = '2bff33ae-7334-457e-a69e-93a5d90b18b3';
const RUNTIME_HASH = 'runtime-hash-boot-and-push';
const RUNTIME_MANIFEST_URL = `exp://preview.test/manifest/${RUNTIME_HASH}`;
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

const CANDIDATE_PROJECT_IDS = [
    VERIFICATION_PROJECT_ID,
    EXPO_BROWSER_TEST_BRANCH.projectId,
    MOBILE_PREVIEW_FIXTURE_PROJECT_ID,
];

interface MobilePreviewEvalPushPayload {
    type: string;
    code: string;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getEditorBaseUrl(): string {
    return process.env.PLAYWRIGHT_BASE_URL?.trim() || 'http://127.0.0.1:3000';
}

function getEditorUrl(path: string): string {
    return new URL(path, `${getEditorBaseUrl().replace(/\/$/, '')}/`).toString();
}

function getMobilePreviewEndpointUrl(path: '/status' | '/push'): string {
    const baseUrl =
        process.env.NEXT_PUBLIC_MOBILE_PREVIEW_URL?.trim() ||
        'http://127.0.0.1:8787';
    const url = new URL(baseUrl);
    url.pathname = path;
    url.search = '';
    url.hash = '';
    return url.toString();
}

async function waitForAuthenticatedSession(page: Page): Promise<void> {
    const userGetUrl = getEditorUrl(`/api/trpc/user.get?batch=1&input=${USER_GET_INPUT}`);

    for (let attempt = 0; attempt < 60; attempt += 1) {
        const cookies = await page.context().cookies([getEditorBaseUrl()]);
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

async function signInWithDevMode(page: Page): Promise<void> {
    const response = await page
        .context()
        .request.get(getEditorUrl('/auth/dev-login?returnUrl=%2Fprojects'))
        .catch(() => null);

    if (response && response.status() >= 500) {
        throw new Error(
            `dev-login route returned ${response.status()} at ${response.url()}`,
        );
    }

    await waitForAuthenticatedSession(page);
}

async function gotoProjectPage(page: Page, projectId: string): Promise<void> {
    try {
        await page.goto(getEditorUrl(`/project/${projectId}`), {
            waitUntil: 'domcontentloaded',
        });
    } catch (error) {
        if (!(error instanceof Error) || !error.message.includes('ERR_ABORTED')) {
            throw error;
        }

        await page.waitForLoadState('domcontentloaded').catch(() => undefined);
    }
}

async function openFirstExpoBrowserProject(page: Page): Promise<string> {
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

    for (const projectId of CANDIDATE_PROJECT_IDS) {
        await gotoProjectPage(page, projectId);

        if (page.url().includes('/login')) {
            await signInWithDevMode(page);
            await gotoProjectPage(page, projectId);
        }

        if (page.url().includes('/see-a-demo')) {
            continue;
        }

        await loadingProject
            .waitFor({ state: 'hidden', timeout: 120_000 })
            .catch(() => undefined);

        if (
            await applicationErrorHeading
                .isVisible({ timeout: 2_000 })
                .catch(() => false)
        ) {
            continue;
        }

        if (!(await previewButton.isVisible({ timeout: 20_000 }).catch(() => false))) {
            continue;
        }

        await previewFrame
            .waitFor({ state: 'attached', timeout: 15_000 })
            .catch(() => undefined);
        await page.waitForTimeout(1_000);
        return projectId;
    }

    throw new Error(
        `Could not find an ExpoBrowser project with a visible preview button. Tried: ${CANDIDATE_PROJECT_IDS.join(
            ', ',
        )}`,
    );
}

async function installMockMobilePreviewSocket(page: Page): Promise<void> {
    await page.addInitScript(() => {
        class MockWebSocket {
            static CONNECTING = 0;
            static OPEN = 1;
            static CLOSING = 2;
            static CLOSED = 3;

            readyState = MockWebSocket.OPEN;
            onopen = null;
            onmessage = null;
            onclose = null;
            onerror = null;

            constructor() {
                setTimeout(() => {
                    this.onopen?.({ type: 'open', target: this });
                }, 0);
            }

            send() {
                return undefined;
            }

            close() {
                if (this.readyState === MockWebSocket.CLOSED) {
                    return;
                }

                this.readyState = MockWebSocket.CLOSED;
                this.onclose?.({
                    code: 1000,
                    reason: '',
                    wasClean: true,
                    target: this,
                });
            }
        }

        Object.defineProperty(globalThis, 'WebSocket', {
            value: MockWebSocket,
            configurable: true,
            writable: true,
        });
    });
}

async function waitForInitialPush(
    firstPush: Promise<MobilePreviewEvalPushPayload>,
    page: Page,
): Promise<MobilePreviewEvalPushPayload> {
    return Promise.race([
        firstPush,
        page.waitForTimeout(30_000).then(() => {
            throw new Error('Timed out waiting for the initial mobile-preview /push request.');
        }),
    ]);
}

test.describe('Mobile preview runtime boot and initial push', () => {
    test('opens the runtime QR flow and pushes a registry-backed eval bundle', async ({
        page,
    }) => {
        test.setTimeout(90_000);

        const statusUrl = getMobilePreviewEndpointUrl('/status');
        const pushUrl = getMobilePreviewEndpointUrl('/push');
        let resolveFirstPush:
            | ((payload: MobilePreviewEvalPushPayload) => void)
            | null = null;
        const firstPush = new Promise<MobilePreviewEvalPushPayload>((resolve) => {
            resolveFirstPush = resolve;
        });
        let sawInitialPush = false;

        await installMockMobilePreviewSocket(page);

        await page.route(new RegExp(`^${escapeRegExp(statusUrl)}$`), async (route) => {
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    runtimeHash: RUNTIME_HASH,
                    clients: 0,
                    manifestUrl: RUNTIME_MANIFEST_URL,
                    runtimeSdkVersion: MOBILE_PREVIEW_FIXTURE_SDK_VERSION,
                }),
            });
        });

        await page.route(new RegExp(`^${escapeRegExp(pushUrl)}$`), async (route) => {
            const body = route.request().postData();
            if (!body) {
                throw new Error('mobile-preview /push request did not include a body.');
            }

            const payload = JSON.parse(body) as MobilePreviewEvalPushPayload;
            if (!sawInitialPush) {
                sawInitialPush = true;
                resolveFirstPush?.(payload);
            }

            await route.fulfill({
                status: 204,
                body: '',
            });
        });

        await signInWithDevMode(page);
        await openFirstExpoBrowserProject(page);

        const firstPushPayload = await waitForInitialPush(firstPush, page);
        expect(firstPushPayload.type).toBe('eval');
        expect(firstPushPayload.code).toContain(
            "const __RUNTIME_SHIM_REGISTRY_KEY = '__onlookShims';",
        );
        expect(firstPushPayload.code).toContain(
            'const __runtimeShim = __resolveRuntimeShim(specifier);',
        );
        expect(firstPushPayload.code).toContain("if (specifier === 'react-native') {");
        expect(firstPushPayload.code).toContain(
            "if (specifier === 'expo-status-bar') {",
        );

        await page.getByTestId('preview-on-device-button').click();

        const manifestUrl = page.getByTestId('qr-manifest-url');
        await expect(manifestUrl).toBeVisible();
        await expect(manifestUrl).toContainText(RUNTIME_MANIFEST_URL);
    });
});
