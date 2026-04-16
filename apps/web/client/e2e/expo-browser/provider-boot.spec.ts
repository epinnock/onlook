/**
 * TE.1 — ExpoBrowser provider boot smoke test.
 *
 * Boots the project editor for the ExpoBrowser test branch and asserts that:
 *   1. The editor mounts without crashing into an error overlay.
 *   2. The bottom-panel Terminal tab is hidden (capability gate from Wave D
 *      §1.7.2 — ExpoBrowser branches do not expose a shell terminal).
 *   3. The chat surface is still available as the replacement interaction UI.
 *
 * This spec will fail until Wave H lands and the corresponding row in the
 * local `branches` table is created — see `e2e/fixtures/test-branch.ts`.
 */
import { expect, test } from '@playwright/test';

import { EXPO_BROWSER_TEST_BRANCH } from '../fixtures/test-branch';
import { seedExpoBrowserTestBranch } from './helpers/setup';
import {
    ensureDevLoggedIn,
    openVerificationProject,
} from '../mobile-preview/helpers/browser';

test.describe('ExpoBrowser provider boot', () => {
    test.beforeAll(() => {
        seedExpoBrowserTestBranch();
    });

    test('mounts the project editor without an error overlay', async ({ page }) => {
        test.setTimeout(180_000);

        const { projectId } = EXPO_BROWSER_TEST_BRANCH;

        await ensureDevLoggedIn(page, `/project/${projectId}`);
        await openVerificationProject(page, projectId);

        await page
            .getByText('Loading project...')
            .waitFor({ state: 'hidden', timeout: 120_000 })
            .catch(() => undefined);

        // No red error overlay should be visible.
        const errorOverlay = page.locator('.error-overlay, [data-testid="error-overlay"]');
        await expect(errorOverlay).toHaveCount(0);

        // Terminal tab must be hidden for ExpoBrowser branches.
        const terminalTab = page.getByRole('tab', { name: /terminal/i });
        await expect(terminalTab).toHaveCount(0);

        // The non-terminal interaction surface should still be available.
        const newChatButton = page.getByRole('button', { name: /new chat/i });
        await expect(newChatButton).toBeVisible();
    });
});
