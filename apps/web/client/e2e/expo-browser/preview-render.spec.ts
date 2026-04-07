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

test.describe('ExpoBrowser preview render', () => {
    test('renders the bundled app inside the preview iframe', async ({ page }) => {
        const { projectId } = EXPO_BROWSER_TEST_BRANCH;

        const consoleErrors: string[] = [];
        page.on('console', (message) => {
            if (message.type() === 'error') {
                consoleErrors.push(message.text());
            }
        });

        await page.goto(`/project/${projectId}`);

        // Editor shell must mount before we probe for the preview iframe.
        const editor = page
            .locator('[data-testid="project-editor"], body[data-onlook-loaded="true"]')
            .first();
        await editor.waitFor({ state: 'attached', timeout: 30_000 });

        // Locate the preview iframe by either its numeric id prefix or by
        // the `/preview/` path in its src attribute.
        const iframe = page.locator('iframe[id^="frame-"], iframe[src*="/preview/"]').first();
        await iframe.waitFor({ state: 'attached', timeout: 30_000 });

        // The src attribute must be routed through the local preview proxy.
        const src = await iframe.getAttribute('src');
        expect(src, 'preview iframe is missing a src attribute').not.toBeNull();
        expect(src).toMatch(/^\/preview\//);

        // Drop into the frame to confirm the Metro bundle actually rendered.
        const frame = page
            .frameLocator('iframe[id^="frame-"], iframe[src*="/preview/"]')
            .first();
        const rendered = frame.locator('#root, [data-onlook-preview-ready="true"]').first();
        await rendered.waitFor({ state: 'attached', timeout: 10_000 });

        const innerHtml = await rendered.innerHTML();
        expect(innerHtml.trim().length, 'preview iframe content should be non-empty').toBeGreaterThan(0);

        // A `PROVIDER_NO_SHELL` console error means a tool fell through to
        // runCommand instead of being dispatched properly — that is a
        // regression signal for the capability gate in Wave D §1.7.
        const shellFallthrough = consoleErrors.filter((line) => line.includes('PROVIDER_NO_SHELL'));
        expect(shellFallthrough, 'no PROVIDER_NO_SHELL console errors expected').toEqual([]);
    });
});
