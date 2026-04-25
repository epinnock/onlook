import type { Provider } from '@onlook/code-provider';
import { ProjectType } from '@onlook/constants';
import { describe, expect, it } from 'bun:test';
import {
    detectProjectTypeFromProvider,
    EXPO_PRELOAD_ENTRY_CANDIDATES,
} from '../preload-script';

type RootEntry = { type: string; name: string };

/**
 * Build a minimal Provider stub that only implements the file-listing and
 * read-file surface area used by detectProjectTypeFromProvider. Every other
 * method throws if called so we catch unexpected usage.
 */
function createProviderStub(options: {
    files: RootEntry[];
    packageJson?: string;
    throwOnList?: boolean;
}): Provider {
    const stub = {
        listFiles: async () => {
            if (options.throwOnList) {
                throw new Error('listFiles failed');
            }
            return { files: options.files };
        },
        readFile: async () => {
            if (options.packageJson === undefined) {
                throw new Error('no package.json in stub');
            }
            return { file: { content: options.packageJson } };
        },
    } as unknown as Provider;
    return stub;
}

describe('detectProjectTypeFromProvider', () => {
    it('returns EXPO when branch providerType is expo_browser and file list is empty', async () => {
        const provider = createProviderStub({ files: [] });
        const result = await detectProjectTypeFromProvider(provider, 'branch-abc', 'expo_browser');
        expect(result).toBe(ProjectType.EXPO);
    });

    it('returns EXPO when branch providerType is expo_browser even when root files look like Next.js', async () => {
        const provider = createProviderStub({
            files: [
                { type: 'file', name: 'next.config.ts' },
                { type: 'file', name: 'package.json' },
            ],
            packageJson: JSON.stringify({ dependencies: { next: '^15.0.0' } }),
        });
        const result = await detectProjectTypeFromProvider(provider, 'branch-abc', 'expo_browser');
        expect(result).toBe(ProjectType.EXPO);
    });

    it('returns NEXTJS when branch providerType is code_sandbox and root files look like Next.js', async () => {
        const provider = createProviderStub({
            files: [
                { type: 'file', name: 'next.config.ts' },
                { type: 'file', name: 'package.json' },
            ],
            packageJson: JSON.stringify({ dependencies: { next: '^15.0.0' } }),
        });
        const result = await detectProjectTypeFromProvider(provider, 'sandbox-xyz', 'code_sandbox');
        expect(result).toBe(ProjectType.NEXTJS);
    });

    it('returns NEXTJS (default) when branch providerType is code_sandbox and file list is empty', async () => {
        const provider = createProviderStub({ files: [] });
        const result = await detectProjectTypeFromProvider(provider, 'sandbox-xyz', 'code_sandbox');
        expect(result).toBe(ProjectType.NEXTJS);
    });
});

describe('EXPO_PRELOAD_ENTRY_CANDIDATES', () => {
    // Regression for commit 52adddc5. The injector iterates this list
    // in order and stops at the first hit. Must cover every entry
    // variant browser-metro's entry-resolver.ts would pick up — else
    // the preload script never injects for that branch and tap-to-
    // source / selector-overlay silently break.
    it('covers all seven TS/JS entry-file variants', () => {
        expect([...EXPO_PRELOAD_ENTRY_CANDIDATES].sort()).toEqual(
            [
                'App.js',
                'App.jsx',
                'App.tsx',
                'index.js',
                'index.jsx',
                'index.ts',
                'index.tsx',
            ].sort(),
        );
    });

    it('prefers index.* over App.* (matches browser-metro entry-resolver precedence)', () => {
        const indexIndex = EXPO_PRELOAD_ENTRY_CANDIDATES.findIndex((f) =>
            f.startsWith('index.'),
        );
        const appIndex = EXPO_PRELOAD_ENTRY_CANDIDATES.findIndex((f) => f.startsWith('App.'));
        expect(indexIndex).toBeLessThan(appIndex);
    });

    it('prefers .tsx over .js at each level', () => {
        // .tsx must appear before .js within both the index.* and App.* groups.
        const tsxIdx = EXPO_PRELOAD_ENTRY_CANDIDATES.indexOf('index.tsx');
        const jsIdx = EXPO_PRELOAD_ENTRY_CANDIDATES.indexOf('index.js');
        expect(tsxIdx).toBeGreaterThanOrEqual(0);
        expect(jsIdx).toBeGreaterThanOrEqual(0);
        expect(tsxIdx).toBeLessThan(jsIdx);

        const appTsxIdx = EXPO_PRELOAD_ENTRY_CANDIDATES.indexOf('App.tsx');
        const appJsIdx = EXPO_PRELOAD_ENTRY_CANDIDATES.indexOf('App.js');
        expect(appTsxIdx).toBeLessThan(appJsIdx);
    });
});
