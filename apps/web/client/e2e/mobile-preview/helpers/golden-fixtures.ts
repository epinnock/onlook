import {
    cloneMobilePreviewFixture,
    MOBILE_PREVIEW_E2E_FIXTURE,
    type MobilePreviewFixture,
} from './fixture';

export interface MobilePreviewGoldenFixture {
    id: string;
    title: string;
    specPath: string;
    fixture: MobilePreviewFixture;
    expectedTexts: readonly string[];
}

export const MOBILE_PREVIEW_GOLDEN_FIXTURE_BASELINE_ID = 'wave-0-smoke';
export const MOBILE_PREVIEW_GOLDEN_FIXTURE_BASELINE_SPEC_PATH =
    'apps/web/client/e2e/mobile-preview/runtime/smoke.spec.ts';

const MOBILE_PREVIEW_GOLDEN_FIXTURE_DEFINITIONS = [
    {
        id: MOBILE_PREVIEW_GOLDEN_FIXTURE_BASELINE_ID,
        title: 'Wave 0 deterministic smoke fixture',
        specPath: MOBILE_PREVIEW_GOLDEN_FIXTURE_BASELINE_SPEC_PATH,
        expectedTexts: [
            MOBILE_PREVIEW_E2E_FIXTURE.expectedTitle,
            MOBILE_PREVIEW_E2E_FIXTURE.expectedSubtitle,
        ],
    },
] as const satisfies readonly Omit<MobilePreviewGoldenFixture, 'fixture'>[];

export function listMobilePreviewGoldenFixtures(): MobilePreviewGoldenFixture[] {
    return MOBILE_PREVIEW_GOLDEN_FIXTURE_DEFINITIONS.map((definition) => ({
        ...definition,
        expectedTexts: [...definition.expectedTexts],
        fixture: cloneMobilePreviewFixture(),
    }));
}

export function getMobilePreviewGoldenFixture(
    id: string,
): MobilePreviewGoldenFixture | null {
    for (const fixture of listMobilePreviewGoldenFixtures()) {
        if (fixture.id === id) {
            return fixture;
        }
    }

    return null;
}

const bunRuntime = (
    globalThis as typeof globalThis & {
        Bun?: { env?: Record<string, string | undefined> };
    }
).Bun;

if (bunRuntime && process.env.NODE_ENV === 'test') {
    const { describe, expect, test } = await import('bun:test');

    describe('MOBILE_PREVIEW_GOLDEN_FIXTURES', () => {
        test('registers the baseline smoke fixture for hardening coverage', () => {
            const fixtures = listMobilePreviewGoldenFixtures();

            expect(
                fixtures.map(({ id, title, specPath }) => ({ id, title, specPath })),
            ).toEqual([
                {
                    id: MOBILE_PREVIEW_GOLDEN_FIXTURE_BASELINE_ID,
                    title: 'Wave 0 deterministic smoke fixture',
                    specPath: MOBILE_PREVIEW_GOLDEN_FIXTURE_BASELINE_SPEC_PATH,
                },
            ]);
        });

        test('clones the deterministic Wave 0 fixture for the baseline entry', () => {
            const goldenFixture = getMobilePreviewGoldenFixture(
                MOBILE_PREVIEW_GOLDEN_FIXTURE_BASELINE_ID,
            );

            expect(goldenFixture).not.toBeNull();
            expect(goldenFixture?.fixture).not.toBe(MOBILE_PREVIEW_E2E_FIXTURE);
            expect(goldenFixture?.fixture.projectId).toBe(
                MOBILE_PREVIEW_E2E_FIXTURE.projectId,
            );
            expect(goldenFixture?.fixture.files).not.toBe(
                MOBILE_PREVIEW_E2E_FIXTURE.files,
            );
            expect(goldenFixture?.fixture.files.map((file) => file.path)).toEqual(
                MOBILE_PREVIEW_E2E_FIXTURE.files.map((file) => file.path),
            );
        });

        test('pins the smoke assertions needed by later golden regression specs', () => {
            const goldenFixture = getMobilePreviewGoldenFixture(
                MOBILE_PREVIEW_GOLDEN_FIXTURE_BASELINE_ID,
            );

            expect(goldenFixture?.expectedTexts).toEqual([
                MOBILE_PREVIEW_E2E_FIXTURE.expectedTitle,
                MOBILE_PREVIEW_E2E_FIXTURE.expectedSubtitle,
            ]);
            expect(goldenFixture?.fixture.expectedTitle).toBe(
                goldenFixture?.expectedTexts[0],
            );
            expect(goldenFixture?.fixture.expectedSubtitle).toBe(
                goldenFixture?.expectedTexts[1],
            );
            expect(getMobilePreviewGoldenFixture('missing-fixture')).toBeNull();
        });
    });
}
