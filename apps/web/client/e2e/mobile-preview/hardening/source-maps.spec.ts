import { expect, test, type Page } from '@playwright/test';

import { EXPO_BROWSER_TEST_BRANCH } from '../../fixtures/test-branch';
import {
    MOBILE_PREVIEW_FIXTURE_PROJECT_ID,
    MOBILE_PREVIEW_FIXTURE_SDK_VERSION,
} from '../helpers/fixture';

const VERIFICATION_PROJECT_ID = '2bff33ae-7334-457e-a69e-93a5d90b18b3';
const RUNTIME_HASH = 'runtime-hash-source-maps';
const RUNTIME_MANIFEST_URL = `exp://preview.test/manifest/${RUNTIME_HASH}`;
const SOURCE_MAPPED_FILE_PATH = 'App.tsx';

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

function findLineContaining(bundleCode: string, searchText: string): number {
    const lines = bundleCode.split('\n');
    const index = lines.findIndex((line) => line.includes(searchText));
    if (index < 0) {
        throw new Error(`Unable to find bundle line containing: ${searchText}`);
    }

    return index + 1;
}

async function signInWithDevMode(page: Page): Promise<void> {
    await page.goto(getEditorUrl('/login'));

    const devModeButton = page.getByRole('button', {
        name: /dev mode: sign in as demo user/i,
    });

    if (!(await devModeButton.isVisible({ timeout: 15_000 }).catch(() => false))) {
        return;
    }

    await devModeButton.click();
    await page.waitForURL((url) => !url.pathname.startsWith('/login'), {
        timeout: 30_000,
    });
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
    const editorReady = page
        .locator('[data-testid="project-editor"], body[data-onlook-loaded="true"]')
        .first();
    const previewFrame = page
        .locator('iframe[id^="frame-"], iframe[src*="/preview/"]')
        .first();
    const previewButton = page.getByTestId('preview-on-device-button');
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

        if (
            await applicationErrorHeading
                .isVisible({ timeout: 2_000 })
                .catch(() => false)
        ) {
            continue;
        }

        const mounted = await editorReady
            .waitFor({ state: 'attached', timeout: 10_000 })
            .then(() => true)
            .catch(() => false);
        if (!mounted) {
            continue;
        }

        const buttonVisible = await previewButton
            .isVisible({ timeout: 10_000 })
            .catch(() => false);
        if (!buttonVisible) {
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

            url;
            readyState = MockWebSocket.OPEN;
            onopen = null;
            onmessage = null;
            onclose = null;
            onerror = null;

            constructor(url: string) {
                this.url = url;
                store.instances.push(this);
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

            emit(data: string) {
                this.onmessage?.({ data, target: this });
            }
        }

        const store = { instances: [] as MockWebSocket[] };

        Object.defineProperty(globalThis, '__mobilePreviewSocketStore', {
            value: store,
            configurable: true,
        });
        Object.defineProperty(globalThis, '__emitMobilePreviewRuntimeMessage', {
            value: (data: string) => {
                for (const socket of store.instances) {
                    socket.emit(data);
                }
            },
            configurable: true,
        });
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

test.describe('Mobile preview source maps', () => {
    test('maps runtime errors back to the original file and line in the editor panel', async ({
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
            '//# sourceMappingURL=data:application/json',
        );

        const generatedLine = findLineContaining(
            firstPushPayload.code,
            'return React.createElement',
        );
        const mappedRuntimeError = `ReferenceError: __missingBinding is not defined (<anonymous>:${generatedLine}:1)`;

        await page.getByTestId('preview-on-device-button').click();

        const manifestUrl = page.getByTestId('qr-manifest-url');
        await expect(manifestUrl).toBeVisible();
        await expect(manifestUrl).toContainText(RUNTIME_MANIFEST_URL);

        await page.evaluate((message) => {
            const target = globalThis as typeof globalThis & {
                __emitMobilePreviewRuntimeMessage?: (data: string) => void;
            };

            target.__emitMobilePreviewRuntimeMessage?.(message);
        }, JSON.stringify({ type: 'evalError', error: mappedRuntimeError }));

        const errorPanel = page.getByTestId('mobile-preview-error-panel');
        await expect(errorPanel).toBeVisible();

        const runtimeErrorItem = page.getByTestId(
            'mobile-preview-error-item-runtime',
        );
        await expect(runtimeErrorItem).toBeVisible();

        const runtimeErrorMessage = page.getByTestId(
            'mobile-preview-error-message-runtime',
        );
        await expect(runtimeErrorMessage).toContainText(
            /ReferenceError: __missingBinding is not defined/,
        );

        const runtimeErrorLink = page.getByTestId(
            'mobile-preview-error-link-runtime-1',
        );
        await expect(runtimeErrorLink).toBeVisible();
        await expect(runtimeErrorLink).toContainText(
            new RegExp(`${escapeRegExp(SOURCE_MAPPED_FILE_PATH)}:\\d+:\\d+`),
        );
        await expect(runtimeErrorLink).toHaveAttribute(
            'href',
            new RegExp(`onlook://file/${escapeRegExp(SOURCE_MAPPED_FILE_PATH)}:\\d+`),
        );
    });
});
