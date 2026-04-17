/**
 * TE.3 — ExpoBrowser preview render smoke test.
 *
 * Boots the project editor and asserts that the in-editor preview iframe
 * is wired through the `/preview/...` app route (Wave H §1.3) and that the
 * Metro-bundled output actually renders something inside the frame.
 *
 * Fails until Wave H lands and the ExpoBrowser test branch exists in the
 * local Postgres database — see `e2e/fixtures/test-branch.ts`.
 */
import { expect, test } from '@playwright/test';

import { EXPO_BROWSER_TEST_BRANCH } from '../fixtures/test-branch';
import { seedExpoBrowserTestBranch } from './helpers/setup';
import {
    ensureDevLoggedIn,
    openVerificationProject,
} from '../mobile-preview/helpers/browser';

test.describe('ExpoBrowser preview render', () => {
    test.beforeAll(() => {
        seedExpoBrowserTestBranch();
    });

    test('renders the bundled app inside the preview iframe', async ({ page }) => {
        test.setTimeout(180_000);

        const { projectId } = EXPO_BROWSER_TEST_BRANCH;

        const consoleErrors: string[] = [];
        page.on('console', (message) => {
            if (message.type() === 'error') {
                consoleErrors.push(message.text());
            }
        });
        page.on('pageerror', (error) => {
            consoleErrors.push(error.message);
        });

        await ensureDevLoggedIn(page, `/project/${projectId}`);
        await openVerificationProject(page, projectId);

        await page
            .getByText('Loading project...')
            .waitFor({ state: 'hidden', timeout: 120_000 })
            .catch(() => undefined);

        const applicationErrorHeading = page
            .getByRole('heading', {
                name: /application error: a client-side exception has occurred/i,
            })
            .first();
        if (
            await applicationErrorHeading
                .isVisible({ timeout: 2_000 })
                .catch(() => false)
        ) {
            throw new Error('Project route rendered a client-side application error.');
        }

        // Locate the preview iframe by either its numeric id prefix or by
        // the `/preview/` path in its src attribute.
        const iframe = page.locator('iframe[id^="frame-"], iframe[src*="/preview/"]').first();
        await iframe.waitFor({ state: 'attached', timeout: 60_000 });

        // The src attribute must be routed through the local preview proxy.
        await expect
            .poll(
                async () => {
                    const src = await iframe.getAttribute('src');
                    if (!src?.trim()) {
                        return '';
                    }

                    try {
                        return new URL(src).pathname;
                    } catch {
                        return src.trim();
                    }
                },
                {
                    timeout: 30_000,
                    message: 'preview iframe never received a /preview/ src',
                },
            )
            .toMatch(/^\/preview\//);

        // Drop into the frame to confirm the Metro bundle actually rendered.
        const frame = page
            .frameLocator('iframe[id^="frame-"], iframe[src*="/preview/"]')
            .first();
        const rendered = frame.locator('#root, [data-onlook-preview-ready="true"]').first();
        await rendered.waitFor({ state: 'attached', timeout: 30_000 });

        const innerHtml = await rendered.innerHTML();
        expect(innerHtml.trim().length, 'preview iframe content should be non-empty').toBeGreaterThan(0);

        // A `PROVIDER_NO_SHELL` console error means a tool fell through to
        // runCommand instead of being dispatched properly — that is a
        // regression signal for the capability gate in Wave D §1.7.
        const shellFallthrough = consoleErrors.filter((line) => line.includes('PROVIDER_NO_SHELL'));
        expect(shellFallthrough, 'no PROVIDER_NO_SHELL console errors expected').toEqual([]);
    });
});
