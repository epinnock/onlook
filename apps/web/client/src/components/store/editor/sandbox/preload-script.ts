import type { Provider } from '@onlook/code-provider';
import {
    detectProjectType,
    NEXT_JS_FILE_EXTENSIONS,
    ONLOOK_DEV_PRELOAD_SCRIPT_PATH,
    ONLOOK_DEV_PRELOAD_SCRIPT_SRC,
    ONLOOK_PRELOAD_SCRIPT_FILE,
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
    console.log('[PreloadScript] detectProjectTypeFromProvider: root files:', files.join(', '));
    const initialType = detectProjectType(files);
    console.log('[PreloadScript] detectProjectTypeFromProvider: initial detection:', initialType);

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
        console.log('[PreloadScript] copyPreloadScriptToPublic called');
        console.log('[PreloadScript]   projectType:', projectType);
        console.log('[PreloadScript]   ONLOOK_DEV_PRELOAD_SCRIPT_SRC:', ONLOOK_DEV_PRELOAD_SCRIPT_SRC);
        console.log('[PreloadScript]   ONLOOK_DEV_PRELOAD_SCRIPT_PATH:', ONLOOK_DEV_PRELOAD_SCRIPT_PATH);

        try {
            await provider.createDirectory({ args: { path: 'public' } });
            console.log('[PreloadScript]   Created public/ directory');
        } catch {
            console.log('[PreloadScript]   public/ directory already exists');
        }

        console.log('[PreloadScript]   Fetching preload script from:', ONLOOK_DEV_PRELOAD_SCRIPT_SRC);
        const scriptResponse = await fetch(ONLOOK_DEV_PRELOAD_SCRIPT_SRC);
        const scriptContent = await scriptResponse.text();
        console.log('[PreloadScript]   Fetched script, length:', scriptContent.length, 'chars');

        await provider.writeFile({
            args: {
                path: ONLOOK_DEV_PRELOAD_SCRIPT_PATH,
                content: scriptContent,
                overwrite: true
            }
        });
        console.log('[PreloadScript]   Wrote script to:', ONLOOK_DEV_PRELOAD_SCRIPT_PATH);

        if (projectType === ProjectType.EXPO) {
            console.log('[PreloadScript]   Project is EXPO, injecting into Expo template...');
            await injectPreloadScriptIntoExpoTemplate(provider);
            return;
        }

        if (!routerConfig) {
            throw new Error('Router config is required for Next.js preload script injection');
        }
        console.log('[PreloadScript]   Project is NextJS, injecting into layout...');
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
    console.log('[PreloadScript] injectPreloadScriptIntoExpoTemplate called');

    // Strategy 1: Inject into web/index.html (works for standard Expo web builds)
    try {
        let templateContent = EXPO_WEB_TEMPLATE_FALLBACK;
        try {
            const response = await provider.readFile({ args: { path: EXPO_WEB_TEMPLATE_PATH } });
            if (typeof response.file.content === 'string') {
                templateContent = response.file.content;
            }
        } catch {
            // web/index.html doesn't exist, use fallback
        }

        if (!templateContent.includes(ONLOOK_DEV_PRELOAD_SCRIPT_SRC)) {
            const scriptTag = `    <script src="${ONLOOK_DEV_PRELOAD_SCRIPT_SRC}" type="module" defer></script>`;
            const modifiedTemplate = templateContent.includes('</body>')
                ? templateContent.replace('</body>', `${scriptTag}\n  </body>`)
                : `${templateContent}\n${scriptTag}\n`;

            await provider.writeFile({
                args: { path: EXPO_WEB_TEMPLATE_PATH, content: modifiedTemplate, overwrite: true },
            });
            console.log('[PreloadScript]   Injected into web/index.html');
        }
    } catch (err) {
        console.warn('[PreloadScript]   web/index.html injection failed:', err);
    }

    // Strategy 2: Inject runtime import into index.js or App.js
    // This is needed for CSB templates with custom Express servers that don't use web/index.html
    const entryFiles = ['index.js', 'App.js', 'App.tsx', 'index.ts'];
    const importLine = `import './${ONLOOK_PRELOAD_SCRIPT_FILE}';\n`;

    for (const entryFile of entryFiles) {
        try {
            const response = await provider.readFile({ args: { path: entryFile } });
            if (typeof response.file.content !== 'string') continue;

            const content = response.file.content;
            if (content.includes(ONLOOK_PRELOAD_SCRIPT_FILE)) {
                console.log(`[PreloadScript]   ${entryFile} already has preload import, skipping`);
                return;
            }

            // Copy preload script to project root (so import resolves)
            const scriptResponse = await provider.readFile({ args: { path: ONLOOK_DEV_PRELOAD_SCRIPT_PATH } });
            if (typeof scriptResponse.file.content === 'string') {
                await provider.writeFile({
                    args: { path: ONLOOK_PRELOAD_SCRIPT_FILE, content: scriptResponse.file.content, overwrite: true },
                });
            }

            // Add import at the top of the entry file
            const modifiedContent = importLine + content;
            await provider.writeFile({
                args: { path: entryFile, content: modifiedContent, overwrite: true },
            });
            console.log(`[PreloadScript]   Injected import into ${entryFile}`);
            return;
        } catch {
            // File doesn't exist, try next
        }
    }

    console.warn('[PreloadScript]   Could not find entry file to inject preload script');
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
