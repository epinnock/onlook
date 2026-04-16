import type { Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

export const VERIFICATION_PROJECT_ID = '2bff33ae-7334-457e-a69e-93a5d90b18b3';
export const VERIFICATION_BRANCH_ID = 'fcebdee5-1010-4147-9748-823a27dc36a3';

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

export function getWebBaseUrl(): string {
    const explicitBaseUrl = process.env.PLAYWRIGHT_BASE_URL?.trim();
    if (explicitBaseUrl) {
        return new URL(explicitBaseUrl).toString();
    }

    const explicitPort =
        process.env.PLAYWRIGHT_PORT?.trim() || process.env.PORT?.trim() || '3000';
    return `http://127.0.0.1:${explicitPort}`;
}

export function buildAppUrl(pathname: string): string {
    return new URL(pathname, getWebBaseUrl()).toString();
}

export async function waitForAuthenticatedSession(page: Page): Promise<void> {
    const userGetUrl = buildAppUrl(`/api/trpc/user.get?batch=1&input=${USER_GET_INPUT}`);

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

export async function gotoAppPath(page: Page, pathname: string): Promise<void> {
    try {
        await page.goto(buildAppUrl(pathname), {
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

export async function ensureDevLoggedIn(
    page: Page,
    returnPath = '/projects',
): Promise<void> {
    const response = await page
        .context()
        .request.get(buildAppUrl(`/auth/dev-login?returnUrl=${encodeURIComponent(returnPath)}`))
        .catch(() => null);

    if (response && response.status() >= 500) {
        throw new Error(`dev-login route returned ${response.status()} at ${response.url()}`);
    }

    await waitForAuthenticatedSession(page);
}

export async function openVerificationProject(
    page: Page,
    projectId = VERIFICATION_PROJECT_ID,
): Promise<void> {
    await gotoAppPath(page, `/project/${projectId}`);

    if (page.url().includes('/login')) {
        await ensureDevLoggedIn(page, `/project/${projectId}`);
        await gotoAppPath(page, `/project/${projectId}`);
    }

    if (page.url().includes('/see-a-demo')) {
        throw new Error(
            `Project ${projectId} redirected to /see-a-demo. Run the verification setup seed first.`,
        );
    }
}

export function seedVerificationFixture(
    repoRoot: string,
    overrides: Record<string, string>,
): void {
    const tempRoot = mkdtempSync(join(tmpdir(), 'onlook-mobile-preview-'));

    try {
        const overrideArgs: string[] = [];

        for (const [logicalPath, content] of Object.entries(overrides)) {
            const localPath = join(tempRoot, logicalPath);
            const lastSlash = localPath.lastIndexOf('/');
            if (lastSlash !== -1) {
                mkdirSync(localPath.slice(0, lastSlash), { recursive: true });
            }
            writeFileSync(localPath, content, 'utf8');
            overrideArgs.push('--override-file', `${logicalPath}=${localPath}`);
        }

        execFileSync(
            'bun',
            [
                'run',
                join(repoRoot, 'scripts/seed-expo-fixture.ts'),
                '--project-id',
                VERIFICATION_PROJECT_ID,
                '--branch-id',
                VERIFICATION_BRANCH_ID,
                ...overrideArgs,
            ],
            {
                cwd: repoRoot,
                encoding: 'utf8',
                stdio: 'pipe',
                timeout: 180_000,
            },
        );
    } finally {
        rmSync(tempRoot, { force: true, recursive: true });
    }
}
