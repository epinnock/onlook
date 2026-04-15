import { expect, test } from '@playwright/test';

import {
    MOBILE_PREVIEW_E2E_FIXTURE,
    MOBILE_PREVIEW_FIXTURE_ENTRY_PATH,
    MOBILE_PREVIEW_FIXTURE_PROJECT_ID,
    MOBILE_PREVIEW_FIXTURE_TITLE,
    getMobilePreviewFixtureFile,
} from '../helpers/fixture';
import { seedMobilePreviewFixture } from '../helpers/seed-fixture';

test.describe('Mobile preview Wave 0 smoke', () => {
    test('fixture helpers expose the expected deterministic Expo app shape', async () => {
        expect(MOBILE_PREVIEW_E2E_FIXTURE.projectId).toBe(
            MOBILE_PREVIEW_FIXTURE_PROJECT_ID,
        );
        expect(MOBILE_PREVIEW_E2E_FIXTURE.entryPath).toBe(
            MOBILE_PREVIEW_FIXTURE_ENTRY_PATH,
        );
        expect(MOBILE_PREVIEW_E2E_FIXTURE.files).toHaveLength(7);
        expect(getMobilePreviewFixtureFile('App.tsx')?.content).toContain(
            MOBILE_PREVIEW_FIXTURE_TITLE,
        );
        expect(
            getMobilePreviewFixtureFile('components/FixtureCard.tsx')?.content,
        ).toContain('FixtureCard');
    });

    test('fixture seeding is deterministic and idempotent for later E2E setup', async () => {
        const files = new Map<string, string>();

        const target = {
            async mkdir() {
                return undefined;
            },
            async readFile(path: string) {
                const content = files.get(path);
                if (content == null) {
                    throw new Error(`ENOENT: ${path}`);
                }
                return content;
            },
            async writeFile(path: string, content: string) {
                files.set(path, content);
            },
        };

        const firstSeed = await seedMobilePreviewFixture(target, {
            basePath: 'workspace/mobile-preview',
        });
        const secondSeed = await seedMobilePreviewFixture(target, {
            basePath: 'workspace/mobile-preview',
        });

        expect(firstSeed.createdPaths).toHaveLength(
            MOBILE_PREVIEW_E2E_FIXTURE.files.length,
        );
        expect(firstSeed.updatedPaths).toHaveLength(0);
        expect(secondSeed.createdPaths).toHaveLength(0);
        expect(secondSeed.updatedPaths).toHaveLength(0);
        expect(secondSeed.unchangedPaths).toHaveLength(
            MOBILE_PREVIEW_E2E_FIXTURE.files.length,
        );
        expect(files.get('workspace/mobile-preview/index.ts')).toContain(
            "AppRegistry.registerComponent('main'",
        );
    });
});
