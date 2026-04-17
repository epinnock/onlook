import { describe, expect, test } from 'bun:test';

import {
    buildMobilePreviewBundle,
    shouldSyncMobilePreviewPath,
    type MobilePreviewVfs,
} from '../index';
import {
    buildInlineAssetModuleCode,
    inlineImageAsset,
    isImageAssetPath,
} from '../bundler/asset-loader';

function makeFakeVfs(
    files: Record<string, string | Uint8Array>,
): MobilePreviewVfs {
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

describe('asset-loader', () => {
    test('identifies image asset paths and inlines them as data URLs', () => {
        const pngBytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
        const assetDataUrl = inlineImageAsset('assets/logo.png', pngBytes);
        const moduleCode = buildInlineAssetModuleCode(assetDataUrl);

        expect(isImageAssetPath('assets/logo.PNG')).toBe(true);
        expect(isImageAssetPath('assets/font.ttf')).toBe(false);
        expect(assetDataUrl).toBe('data:image/png;base64,iVBORw0KGgo=');
        expect(moduleCode).toContain(
            'const asset = {"uri":"data:image/png;base64,iVBORw0KGgo="};',
        );
        expect(moduleCode).toContain('module.exports.default = asset;');
    });

    test('builds bundles for extensionless image imports', async () => {
        const vfs = makeFakeVfs({
            'App.tsx': `
                import logo from './assets/logo';

                export default function App() {
                    return logo ? null : null;
                }
            `,
            'assets/logo.png': new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
        });

        const bundle = await buildMobilePreviewBundle(vfs);

        expect(bundle.entryPath).toBe('App.tsx');
        expect(bundle.moduleCount).toBe(2);
        expect(bundle.code).toContain(`"assets/logo.png": function`);
        expect(bundle.code).toContain(`require('assets/logo.png')`);
        expect(bundle.code).toContain('data:image/png;base64,iVBORw0KGgo=');
    });
});

describe('shouldSyncMobilePreviewPath', () => {
    test('accepts supported image assets', () => {
        expect(shouldSyncMobilePreviewPath('/assets/logo.png')).toBe(true);
        expect(shouldSyncMobilePreviewPath('/assets/logo.SVG')).toBe(true);
    });

    test('rejects unsupported binary files', () => {
        expect(shouldSyncMobilePreviewPath('/assets/font.ttf')).toBe(false);
    });
});
