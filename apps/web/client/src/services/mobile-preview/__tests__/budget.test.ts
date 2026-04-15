import { describe, expect, test } from 'bun:test';

import {
    buildMobilePreviewBundle,
    MobilePreviewBundleError,
    type MobilePreviewVfs,
} from '../index';
import {
    MOBILE_PREVIEW_BUNDLE_HARD_LIMIT_BYTES,
    MOBILE_PREVIEW_BUNDLE_WARNING_BYTES,
} from '../bundler/budget';

function makeFakeVfs(files: Record<string, string>): MobilePreviewVfs {
    const normalizedFiles = new Map(
        Object.entries(files).map(([filePath, content]) => [
            filePath.startsWith('/') ? filePath.slice(1) : filePath,
            content,
        ]),
    );

    return {
        async listAll() {
            return Array.from(normalizedFiles.keys()).map((path) => ({
                path,
                type: 'file' as const,
            }));
        },
        async readFile(path) {
            const normalizedPath = path.startsWith('/') ? path.slice(1) : path;
            const content = normalizedFiles.get(normalizedPath);
            if (content == null) {
                throw new Error(`Missing file: ${normalizedPath}`);
            }
            return content;
        },
        watchDirectory() {
            return () => undefined;
        },
    };
}

describe('mobile preview bundle budget', () => {
    test('returns bundle budget metadata without warning below the threshold', async () => {
        const bundle = await buildMobilePreviewBundle(
            makeFakeVfs({
                'App.tsx': `
                    export default function App() {
                        return null;
                    }
                `,
            }),
        );

        expect(bundle.budget.warningMessage).toBeNull();
        expect(bundle.budget.bytes).toBeGreaterThan(0);
        expect(bundle.budget.warningThresholdBytes).toBe(
            MOBILE_PREVIEW_BUNDLE_WARNING_BYTES,
        );
        expect(bundle.budget.hardLimitBytes).toBe(
            MOBILE_PREVIEW_BUNDLE_HARD_LIMIT_BYTES,
        );
    });

    test('warns when the bundle exceeds the soft budget', async () => {
        const filler = 'x'.repeat(MOBILE_PREVIEW_BUNDLE_WARNING_BYTES);
        const warnings: unknown[][] = [];
        const originalWarn = console.warn;

        console.warn = (...args: unknown[]) => {
            warnings.push(args);
        };

        try {
            const bundle = await buildMobilePreviewBundle(
                makeFakeVfs({
                    'App.tsx': `
                        const filler = ${JSON.stringify(filler)};

                        export default function App() {
                            return filler ? null : null;
                        }
                    `,
                }),
            );

            expect(bundle.budget.bytes).toBeGreaterThan(
                MOBILE_PREVIEW_BUNDLE_WARNING_BYTES,
            );
            expect(bundle.budget.warningMessage).toContain(
                'exceeds the warning budget',
            );
        } finally {
            console.warn = originalWarn;
        }

        expect(warnings).toHaveLength(1);
        expect(String(warnings[0]?.[0])).toContain('[mobile-preview]');
        expect(String(warnings[0]?.[0])).toContain('warning budget of 500 KB');
    });

    test('hard-fails when the bundle exceeds the maximum budget', async () => {
        const filler = 'x'.repeat(MOBILE_PREVIEW_BUNDLE_HARD_LIMIT_BYTES + 1);

        await expect(
            buildMobilePreviewBundle(
                makeFakeVfs({
                    'App.tsx': `
                        const filler = ${JSON.stringify(filler)};

                        export default function App() {
                            return filler;
                        }
                    `,
                }),
            ),
        ).rejects.toBeInstanceOf(MobilePreviewBundleError);

        await expect(
            buildMobilePreviewBundle(
                makeFakeVfs({
                    'App.tsx': `
                        const filler = ${JSON.stringify(filler)};

                        export default function App() {
                            return filler;
                        }
                    `,
                }),
            ),
        ).rejects.toThrow(/hard limit of 2 MB/);
    });
});
