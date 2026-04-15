/**
 * MPE-E4 — Productivity SDK smoke spec for browser-only mobile preview.
 *
 * Covers the no-op/native-fallback Expo modules that are expected to boot
 * cleanly in the mobile-preview runtime:
 *   - expo-notifications
 *   - expo-contacts
 *   - expo-calendar
 */
import { expect, test } from '@playwright/test';

import { EXPO_BROWSER_TEST_BRANCH } from '../../fixtures/test-branch';

const PRODUCTIVITY_MODULE_PATTERN =
    /expo-(notifications|contacts|calendar)|Native module cannot be null|TurboModuleRegistry|getEnforcing\(/i;

test.describe('Mobile preview Expo productivity SDK shims', () => {
    test('boots preview-on-device without productivity module errors', async ({
        page,
    }) => {
        const { projectId } = EXPO_BROWSER_TEST_BRANCH;
        const consoleErrors: string[] = [];

        page.on('console', (message) => {
            if (message.type() === 'error' || message.type() === 'warning') {
                consoleErrors.push(message.text());
            }
        });
        page.on('pageerror', (error) => {
            consoleErrors.push(error.message);
        });

        await page.goto(`/project/${projectId}`);

        const editor = page
            .locator('[data-testid="project-editor"], body[data-onlook-loaded="true"]')
            .first();
        await editor.waitFor({ state: 'attached', timeout: 30_000 });

        const previewButton = page.getByTestId('preview-on-device-button');
        await expect(previewButton).toBeVisible();
        await previewButton.click();

        await expect(
            page.getByRole('heading', { name: /preview on device/i }),
        ).toBeVisible();

        const modalBody = page.getByTestId('qr-modal-body');
        await modalBody.waitFor({ state: 'visible', timeout: 10_000 });

        await expect(
            page.getByTestId('qr-status-preparing').or(
                page.getByTestId('qr-status-building'),
            ).or(page.getByTestId('qr-manifest-url')).or(
                page.getByTestId('qr-status-error'),
            ),
        ).toBeVisible();

        const productivityErrors = consoleErrors.filter((line) => {
            if (!PRODUCTIVITY_MODULE_PATTERN.test(line)) {
                return false;
            }

            return (
                line.includes('expo-notifications') ||
                line.includes('expo-contacts') ||
                line.includes('expo-calendar') ||
                line.includes('TurboModuleRegistry') ||
                line.includes('Native module cannot be null') ||
                line.includes('getEnforcing(')
            );
        });

        expect(
            productivityErrors,
            'Preview-on-device boot should not surface missing productivity SDK shims.',
        ).toEqual([]);
    });
});
