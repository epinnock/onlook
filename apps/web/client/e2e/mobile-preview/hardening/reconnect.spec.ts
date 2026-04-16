import { expect, test, type Page } from '@playwright/test';

import { EXPO_BROWSER_TEST_BRANCH } from '../../fixtures/test-branch';
import { seedExpoBrowserTestBranch } from '../../expo-browser/helpers/setup';
import {
    MOBILE_PREVIEW_FIXTURE_SDK_VERSION,
} from '../helpers/fixture';
import {
    ensureDevLoggedIn,
    openVerificationProject,
} from '../helpers/browser';
const RUNTIME_HASH = 'runtime-hash-reconnect';
const RUNTIME_MANIFEST_URL = `exp://preview.test/manifest/${RUNTIME_HASH}`;

interface MobilePreviewEvalPushPayload {
    type: string;
    code: string;
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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

async function openReconnectProject(page: Page): Promise<void> {
    const previewButton = page.getByTestId('preview-on-device-button');
    const loadingProject = page.getByText('Loading project...');
    const applicationErrorHeading = page
        .getByRole('heading', {
            name: /application error: a client-side exception has occurred/i,
        })
        .first();

    await ensureDevLoggedIn(page, `/project/${EXPO_BROWSER_TEST_BRANCH.projectId}`);
    await openVerificationProject(page, EXPO_BROWSER_TEST_BRANCH.projectId);

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
}

async function installBounceableStatusSocket(page: Page): Promise<void> {
    await page.addInitScript(() => {
        class MockWebSocket {
            static CONNECTING = 0;
            static OPEN = 1;
            static CLOSING = 2;
            static CLOSED = 3;

            static nextId = 1;

            id;
            url;
            readyState = MockWebSocket.CONNECTING;
            onopen = null;
            onmessage = null;
            onclose = null;
            onerror = null;

            constructor(url: string) {
                this.id = MockWebSocket.nextId++;
                this.url = url;
                store.instances.push(this);
                store.connectionCount += 1;

                setTimeout(() => {
                    if (this.readyState !== MockWebSocket.CONNECTING) {
                        return;
                    }

                    if (store.online) {
                        this.readyState = MockWebSocket.OPEN;
                        this.onopen?.({ type: 'open', target: this });
                        return;
                    }

                    this.readyState = MockWebSocket.CLOSED;
                    this.onclose?.({
                        code: 1012,
                        reason: 'server bounce',
                        wasClean: false,
                        target: this,
                    });
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
                if (this.readyState !== MockWebSocket.OPEN) {
                    return;
                }

                this.onmessage?.({ data, target: this });
            }
        }

        const store = {
            connectionCount: 0,
            instances: [] as MockWebSocket[],
            online: true,
        };

        Object.defineProperty(globalThis, '__mobilePreviewReconnectStore', {
            value: store,
            configurable: true,
        });
        Object.defineProperty(globalThis, '__bounceMobilePreviewSocketServer', {
            value: () => {
                store.online = false;
                for (const socket of store.instances) {
                    if (socket.readyState === MockWebSocket.OPEN) {
                        socket.readyState = MockWebSocket.CLOSED;
                        socket.onclose?.({
                            code: 1012,
                            reason: 'server bounce',
                            wasClean: false,
                            target: socket,
                        });
                    }
                }
            },
            configurable: true,
        });
        Object.defineProperty(globalThis, '__restoreMobilePreviewSocketServer', {
            value: () => {
                store.online = true;
            },
            configurable: true,
        });
        Object.defineProperty(globalThis, '__getMobilePreviewReconnectState', {
            value: () => ({
                connectionCount: store.connectionCount,
                openSocketIds: store.instances
                    .filter((socket) => socket.readyState === MockWebSocket.OPEN)
                    .map((socket) => socket.id),
            }),
            configurable: true,
        });
        Object.defineProperty(globalThis, '__emitMobilePreviewReconnectMessage', {
            value: (data: string) => {
                for (const socket of store.instances) {
                    if (socket.readyState === MockWebSocket.OPEN) {
                        socket.emit(data);
                    }
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

async function getReconnectState(page: Page): Promise<{
    connectionCount: number;
    openSocketIds: number[];
}> {
    return page.evaluate(() => {
        const target = globalThis as typeof globalThis & {
            __getMobilePreviewReconnectState?: () => {
                connectionCount: number;
                openSocketIds: number[];
            };
        };

        return (
            target.__getMobilePreviewReconnectState?.() ?? {
                connectionCount: 0,
                openSocketIds: [],
            }
        );
    });
}

test.describe('Mobile preview reconnect after server bounce', () => {
    test.beforeAll(() => {
        seedExpoBrowserTestBranch();
    });

    test('reconnects the status socket and restores ready state after a simulated bounce', async ({
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

        await installBounceableStatusSocket(page);

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

        await openReconnectProject(page);

        const firstPushPayload = await waitForInitialPush(firstPush, page);
        expect(firstPushPayload.type).toBe('eval');

        await page.getByTestId('preview-on-device-button').click();

        const manifestUrl = page.getByTestId('qr-manifest-url');
        await expect(manifestUrl).toBeVisible();
        await expect(manifestUrl).toContainText(RUNTIME_MANIFEST_URL);

        await expect.poll(
            async () => (await getReconnectState(page)).openSocketIds.length,
            {
                message: 'expected at least one open mobile preview socket',
            },
        ).toBeGreaterThan(0);
        const initialState = await getReconnectState(page);

        await page.evaluate(() => {
            const target = globalThis as typeof globalThis & {
                __bounceMobilePreviewSocketServer?: () => void;
            };

            target.__bounceMobilePreviewSocketServer?.();
        });

        await expect.poll(
            async () => (await getReconnectState(page)).openSocketIds.length,
            {
                message: 'expected the preview sockets to close after a simulated bounce',
            },
        ).toBe(0);
        await expect.poll(
            async () => (await getReconnectState(page)).connectionCount,
            {
                message: 'expected a reconnect attempt after the simulated bounce',
            },
        ).toBeGreaterThan(initialState.connectionCount);
        const bouncedState = await getReconnectState(page);

        await page.evaluate(() => {
            const target = globalThis as typeof globalThis & {
                __restoreMobilePreviewSocketServer?: () => void;
            };

            target.__restoreMobilePreviewSocketServer?.();
        });

        await expect
            .poll(async () => (await getReconnectState(page)).connectionCount, {
                message: 'expected the preview runtime to reconnect after restore',
            })
            .toBeGreaterThan(bouncedState.connectionCount);
        await expect.poll(
            async () => (await getReconnectState(page)).openSocketIds.length,
            {
                message: 'expected at least one reopened preview socket after restore',
            },
        ).toBeGreaterThan(0);

        await page.evaluate((message) => {
            const target = globalThis as typeof globalThis & {
                __emitMobilePreviewReconnectMessage?: (data: string) => void;
            };

            target.__emitMobilePreviewReconnectMessage?.(message);
        }, JSON.stringify({ type: 'evalError', error: 'post-bounce runtime error' }));

        const runtimeErrorPanel = page.getByTestId('mobile-preview-error-panel');
        await expect(runtimeErrorPanel).toBeVisible();
        await expect(
            page.getByTestId('mobile-preview-error-message-runtime'),
        ).toContainText('post-bounce runtime error');

        await page.evaluate((message) => {
            const target = globalThis as typeof globalThis & {
                __emitMobilePreviewReconnectMessage?: (data: string) => void;
            };

            target.__emitMobilePreviewReconnectMessage?.(message);
        }, JSON.stringify({ type: 'evalResult', result: 'ok' }));

        await expect(manifestUrl).toBeVisible();
        await expect(manifestUrl).toContainText(RUNTIME_MANIFEST_URL);
    });
});
