import type { Provider } from '@onlook/code-provider';
import {
    detectProjectType,
    NEXT_JS_FILE_EXTENSIONS,
    ONLOOK_DEV_PRELOAD_SCRIPT_PATH,
    ONLOOK_DEV_PRELOAD_SCRIPT_SRC,
    ProjectType,
} from '@onlook/constants';
import { RouterType, type RouterConfig } from '@onlook/models';
import { getAstFromContent, getContentFromAst, injectPreloadScript } from '@onlook/parser';
import { isRootLayoutFile, normalizePath } from '@onlook/utility';
import path from 'path';

const EXPO_WEB_TEMPLATE_PATH = 'web/index.html';
const EXPO_WEB_TEMPLATE_FALLBACK = `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Onlook Expo App</title>
  </head>
  <body>
    <div id="root"></div>
  </body>
</html>
`;

export async function detectProjectTypeFromProvider(provider: Provider): Promise<ProjectType> {
    let rootFiles: Array<{ type: string; name: string }> = [];
    try {
        const root = await provider.listFiles({ args: { path: '.' } });
        rootFiles = root.files;
    } catch {
        try {
            const root = await provider.listFiles({ args: { path: '' } });
            rootFiles = root.files;
        } catch {
            return ProjectType.NEXTJS;
        }
    }

    const files = rootFiles.filter((entry) => entry.type === 'file').map((entry) => entry.name);
    const initialType = detectProjectType(files);

    if (initialType === ProjectType.EXPO || !files.includes('package.json')) {
        return initialType;
    }

    try {
        const packageJsonResponse = await provider.readFile({ args: { path: 'package.json' } });
        const packageJsonContent = packageJsonResponse.file.content;
        if (typeof packageJsonContent !== 'string') {
            return initialType;
        }

        const packageJson = JSON.parse(packageJsonContent) as {
            dependencies?: Record<string, string>;
            devDependencies?: Record<string, string>;
        };
        const allDeps = {
            ...(packageJson.dependencies ?? {}),
            ...(packageJson.devDependencies ?? {}),
        };
        if ('expo' in allDeps) {
            return ProjectType.EXPO;
        }
    } catch (error) {
        console.warn('[PreloadScript] Could not inspect package.json for project type detection', error);
    }

    return initialType;
}

export async function copyPreloadScriptToPublic(
    provider: Provider,
    projectType: ProjectType,
    routerConfig: RouterConfig | null,
): Promise<void> {
    try {
        try {
            await provider.createDirectory({ args: { path: 'public' } });
        } catch {
            // Directory might already exist, ignore error
        }

        const scriptResponse = await fetch(ONLOOK_DEV_PRELOAD_SCRIPT_SRC);
        await provider.writeFile({
            args: {
                path: ONLOOK_DEV_PRELOAD_SCRIPT_PATH,
                content: await scriptResponse.text(),
                overwrite: true
            }
        });

        if (projectType === ProjectType.EXPO) {
            await injectPreloadScriptIntoExpoTemplate(provider);
            return;
        }

        if (!routerConfig) {
            throw new Error('Router config is required for Next.js preload script injection');
        }
        await injectPreloadScriptIntoLayout(provider, routerConfig);
    } catch (error) {
        console.error('[PreloadScript] Failed to copy preload script:', error);
    }
}

export async function injectPreloadScriptIntoLayout(provider: Provider, routerConfig: RouterConfig): Promise<void> {
    if (!routerConfig) {
        throw new Error('Could not detect router type for script injection. This is required for iframe communication.');
    }

    const result = await provider.listFiles({ args: { path: routerConfig.basePath } });
    const [layoutFile] = result.files.filter(file =>
        file.type === 'file' && isRootLayoutFile(`${routerConfig.basePath}/${file.name}`, routerConfig.type)
    );

    if (!layoutFile) {
        throw new Error(`No layout files found in ${routerConfig.basePath}`);
    }

    const layoutPath = `${routerConfig.basePath}/${layoutFile.name}`;

    const layoutResponse = await provider.readFile({ args: { path: layoutPath } });
    if (typeof layoutResponse.file.content !== 'string') {
        throw new Error(`Layout file ${layoutPath} is not a text file`);
    }

    const content = layoutResponse.file.content;
    const ast = getAstFromContent(content);
    if (!ast) {
        throw new Error(`Failed to parse layout file: ${layoutPath}`);
    }

    injectPreloadScript(ast);
    const modifiedContent = await getContentFromAst(ast, content);

    await provider.writeFile({
        args: {
            path: layoutPath,
            content: modifiedContent,
            overwrite: true
        }
    });
}

export async function injectPreloadScriptIntoExpoTemplate(provider: Provider): Promise<void> {
    let templateContent = EXPO_WEB_TEMPLATE_FALLBACK;
    try {
        const response = await provider.readFile({ args: { path: EXPO_WEB_TEMPLATE_PATH } });
        if (typeof response.file.content === 'string') {
            templateContent = response.file.content;
        }
    } catch {
        // The Expo template file is optional; we'll create it when missing.
    }

    if (templateContent.includes(ONLOOK_DEV_PRELOAD_SCRIPT_SRC)) {
        return;
    }

    const scriptTag = `    <script src="${ONLOOK_DEV_PRELOAD_SCRIPT_SRC}" type="module" defer></script>`;
    const modifiedTemplate = templateContent.includes('</body>')
        ? templateContent.replace('</body>', `${scriptTag}\n  </body>`)
        : `${templateContent}\n${scriptTag}\n`;

    await provider.writeFile({
        args: {
            path: EXPO_WEB_TEMPLATE_PATH,
            content: modifiedTemplate,
            overwrite: true,
        },
    });
}

export async function getLayoutPath(routerConfig: RouterConfig, fileExists: (path: string) => Promise<boolean>): Promise<string | null> {
    if (!routerConfig) {
        console.log('Could not detect Next.js router type');
        return null;
    }

    let layoutFileName: string;

    if (routerConfig.type === RouterType.PAGES) {
        layoutFileName = '_app';
    } else {
        layoutFileName = 'layout';
    }

    for (const extension of NEXT_JS_FILE_EXTENSIONS) {
        const layoutPath = path.join(routerConfig.basePath, `${layoutFileName}${extension}`);
        if (await fileExists(layoutPath)) {
            return normalizePath(layoutPath);
        }
    }

    console.log('Could not find layout file');
    return null;
}
