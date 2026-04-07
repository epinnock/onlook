/**
 * TE.1 — ExpoBrowser provider boot smoke test.
 *
 * Boots the project editor for the ExpoBrowser test branch and asserts that:
 *   1. The editor mounts without crashing into an error overlay.
 *   2. The bottom-panel Terminal tab is hidden (capability gate from Wave D
 *      §1.7.2 — ExpoBrowser branches do not expose a shell terminal).
 *   3. The bottom-panel Task tab is visible (its replacement surface).
 *
 * This spec will fail until Wave H lands and the corresponding row in the
 * local `branches` table is created — see `e2e/fixtures/test-branch.ts`.
 */
import { expect, test } from '@playwright/test';

import { EXPO_BROWSER_TEST_BRANCH } from '../fixtures/test-branch';

test.describe('ExpoBrowser provider boot', () => {
    test('mounts the project editor without an error overlay', async ({ page }) => {
        const { projectId } = EXPO_BROWSER_TEST_BRANCH;

        await page.goto(`/project/${projectId}`);

        // Wait for the editor shell to mount. Either the explicit testid or
        // the body-level loaded marker is acceptable.
        const editor = page
            .locator('[data-testid="project-editor"], body[data-onlook-loaded="true"]')
            .first();
        await editor.waitFor({ state: 'attached', timeout: 30_000 });

        // No red error overlay should be visible.
        const errorOverlay = page.locator('.error-overlay, [data-testid="error-overlay"]');
        await expect(errorOverlay).toHaveCount(0);

        // Terminal tab must be hidden for ExpoBrowser branches.
        const terminalTab = page.getByRole('tab', { name: /terminal/i });
        await expect(terminalTab).toHaveCount(0);

        // Task tab must be visible.
        const taskTab = page.getByRole('tab', { name: /task/i });
        await expect(taskTab).toBeVisible();
    });
});
