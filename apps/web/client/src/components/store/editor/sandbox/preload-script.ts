import type { Provider } from '@onlook/code-provider';
import {
    detectProjectType,
    NEXT_JS_FILE_EXTENSIONS,
    ONLOOK_DEV_PRELOAD_SCRIPT_PATH,
    ONLOOK_DEV_PRELOAD_SCRIPT_SRC,
    ONLOOK_PRELOAD_SCRIPT_FILE,
    ProjectType,
} from '@onlook/constants';
import { RouterType, type BranchProviderType, type RouterConfig } from '@onlook/models';
import { getAstFromContent, getContentFromAst, injectPreloadScript } from '@onlook/parser';
import { isRootLayoutFile, normalizePath } from '@onlook/utility';
import path from 'path';

const CF_WORKSPACE_PREFIX = '/workspace/app';

/**
 * Resolve a relative project path for the correct sandbox environment.
 * Cloudflare sandboxes (sandbox IDs starting with 'cf-') scaffold projects
 * under /workspace/app, so all file operations need that prefix.
 */
function resolveProjectPath(sandboxId: string, relativePath: string): string {
    if (sandboxId.startsWith('cf-')) {
        const normalized = relativePath.startsWith('/') ? relativePath : `/${relativePath}`;
        return `${CF_WORKSPACE_PREFIX}${normalized}`;
    }
    return relativePath;
}

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

export async function detectProjectTypeFromProvider(
    provider: Provider,
    sandboxId: string = '',
    providerType?: BranchProviderType,
): Promise<ProjectType> {
    // Branch providerType is the source of truth: if the branch is an
    // ExpoBrowser branch, short-circuit the file-listing heuristic. This
    // avoids false-positive NEXTJS classification when listFiles returns
    // an empty result (e.g. Cloudflare sandboxes before storage sync, or
    // ExpoBrowser branches backed by Supabase Storage).
    if (providerType === 'expo_browser') {
        console.log('[PreloadScript] detectProjectTypeFromProvider: short-circuit via branch.providerType = expo_browser');
        return ProjectType.EXPO;
    }

    let rootFiles: Array<{ type: string; name: string }> = [];
    try {
        const root = await provider.listFiles({ args: { path: resolveProjectPath(sandboxId, '.') } });
        rootFiles = root.files;
    } catch {
        try {
            const root = await provider.listFiles({ args: { path: resolveProjectPath(sandboxId, '') } });
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
        const packageJsonResponse = await provider.readFile({ args: { path: resolveProjectPath(sandboxId, 'package.json') } });
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
    sandboxId: string = '',
): Promise<void> {
    try {
        console.log('[PreloadScript] copyPreloadScriptToPublic called');
        console.log('[PreloadScript]   projectType:', projectType);
        console.log('[PreloadScript]   sandboxId:', sandboxId);
        console.log('[PreloadScript]   ONLOOK_DEV_PRELOAD_SCRIPT_SRC:', ONLOOK_DEV_PRELOAD_SCRIPT_SRC);
        console.log('[PreloadScript]   ONLOOK_DEV_PRELOAD_SCRIPT_PATH:', ONLOOK_DEV_PRELOAD_SCRIPT_PATH);

        const publicDir = resolveProjectPath(sandboxId, 'public');
        const scriptPath = resolveProjectPath(sandboxId, ONLOOK_DEV_PRELOAD_SCRIPT_PATH);

        try {
            await provider.createDirectory({ args: { path: publicDir } });
            console.log('[PreloadScript]   Created directory:', publicDir);
        } catch {
            console.log('[PreloadScript]   Directory already exists:', publicDir);
        }

        console.log('[PreloadScript]   Fetching preload script from:', ONLOOK_DEV_PRELOAD_SCRIPT_SRC);
        const scriptResponse = await fetch(ONLOOK_DEV_PRELOAD_SCRIPT_SRC);
        const scriptContent = await scriptResponse.text();
        console.log('[PreloadScript]   Fetched script, length:', scriptContent.length, 'chars');

        await provider.writeFile({
            args: {
                path: scriptPath,
                content: scriptContent,
                overwrite: true
            }
        });
        console.log('[PreloadScript]   Wrote script to:', scriptPath);

        if (projectType === ProjectType.EXPO) {
            console.log('[PreloadScript]   Project is EXPO, injecting into Expo template...');
            await injectPreloadScriptIntoExpoTemplate(provider, sandboxId);
            return;
        }

        if (!routerConfig) {
            throw new Error('Router config is required for Next.js preload script injection');
        }
        console.log('[PreloadScript]   Project is NextJS, injecting into layout...');
        await injectPreloadScriptIntoLayout(provider, routerConfig, sandboxId);
    } catch (error) {
        console.error('[PreloadScript] Failed to copy preload script:', error);
    }
}

export async function injectPreloadScriptIntoLayout(provider: Provider, routerConfig: RouterConfig, sandboxId: string = ''): Promise<void> {
    if (!routerConfig) {
        throw new Error('Could not detect router type for script injection. This is required for iframe communication.');
    }

    const listPath = resolveProjectPath(sandboxId, routerConfig.basePath);
    const result = await provider.listFiles({ args: { path: listPath } });
    const [layoutFile] = result.files.filter(file =>
        file.type === 'file' && isRootLayoutFile(`${routerConfig.basePath}/${file.name}`, routerConfig.type)
    );

    if (!layoutFile) {
        throw new Error(`No layout files found in ${routerConfig.basePath}`);
    }

    const layoutPath = resolveProjectPath(sandboxId, `${routerConfig.basePath}/${layoutFile.name}`);

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

export async function injectPreloadScriptIntoExpoTemplate(provider: Provider, sandboxId: string = ''): Promise<void> {
    console.log('[PreloadScript] injectPreloadScriptIntoExpoTemplate called');

    // Strategy 1: Inject into web/index.html (works for standard Expo web builds)
    try {
        let templateContent = EXPO_WEB_TEMPLATE_FALLBACK;
        const templatePath = resolveProjectPath(sandboxId, EXPO_WEB_TEMPLATE_PATH);
        try {
            const response = await provider.readFile({ args: { path: templatePath } });
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
                args: { path: templatePath, content: modifiedTemplate, overwrite: true },
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
            const entryPath = resolveProjectPath(sandboxId, entryFile);
            const response = await provider.readFile({ args: { path: entryPath } });
            if (typeof response.file.content !== 'string') continue;

            const content = response.file.content;
            if (content.includes(ONLOOK_PRELOAD_SCRIPT_FILE)) {
                console.log(`[PreloadScript]   ${entryFile} already has preload import, skipping`);
                return;
            }

            // Copy preload script to project root (so import resolves)
            const scriptSrcPath = resolveProjectPath(sandboxId, ONLOOK_DEV_PRELOAD_SCRIPT_PATH);
            const scriptDestPath = resolveProjectPath(sandboxId, ONLOOK_PRELOAD_SCRIPT_FILE);
            const scriptResponse = await provider.readFile({ args: { path: scriptSrcPath } });
            if (typeof scriptResponse.file.content === 'string') {
                await provider.writeFile({
                    args: { path: scriptDestPath, content: scriptResponse.file.content, overwrite: true },
                });
            }

            // Add import at the top of the entry file
            const modifiedContent = importLine + content;
            await provider.writeFile({
                args: { path: entryPath, content: modifiedContent, overwrite: true },
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
