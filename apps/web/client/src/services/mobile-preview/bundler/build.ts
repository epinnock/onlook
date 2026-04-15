import { readProjectFiles } from './files';
import { collectDependencyGraph } from './graph';
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

    return {
        code: wrapEvalBundle(entryPath, orderedModules, moduleMap),
        entryPath,
        moduleCount: orderedModules.length,
    };
}
