import { readProjectFiles } from './files';
import { collectDependencyGraph } from './graph';
import { evaluateMobilePreviewBundleBudget } from './budget';
import { preflightUnsupportedMobilePreviewImports } from './preflight';
import { resolveEntryPath } from './resolution';
import { wrapEvalBundle } from './runtime';
import { buildModuleCode } from './transpile';
import {
    MobilePreviewBundleError,
    type MobilePreviewBundleResult,
    type MobilePreviewVfs,
} from './types';

export async function buildMobilePreviewBundle(
    vfs: MobilePreviewVfs,
): Promise<MobilePreviewBundleResult> {
    const files = await readProjectFiles(vfs);
    const entryPath = resolveEntryPath(files);
    preflightUnsupportedMobilePreviewImports(files, entryPath);
    const orderedModules = collectDependencyGraph(files, entryPath);
    const moduleMap: Record<string, string> = {};

    for (const filePath of orderedModules) {
        const source = files.get(filePath);
        if (source == null) {
            throw new MobilePreviewBundleError(
                `Missing module "${filePath}" while building the mobile preview bundle.`,
            );
        }
        moduleMap[filePath] = buildModuleCode(filePath, source, files);
    }

    const code = wrapEvalBundle(entryPath, orderedModules, moduleMap);
    const budget = evaluateMobilePreviewBundleBudget(code);

    if (budget.warningMessage) {
        console.warn(`[mobile-preview] ${budget.warningMessage}`);
    }

    return {
        code,
        entryPath,
        moduleCount: orderedModules.length,
        budget,
    };
}
