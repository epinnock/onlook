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

const ENTRY_SYNC_RETRY_COUNT = 20;
const ENTRY_SYNC_RETRY_DELAY_MS = 250;

export async function buildMobilePreviewBundle(
    vfs: MobilePreviewVfs,
): Promise<MobilePreviewBundleResult> {
    for (let attempt = 0; attempt < ENTRY_SYNC_RETRY_COUNT; attempt += 1) {
        const files = await readProjectFiles(vfs);

        try {
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
        } catch (error) {
            const isMissingEntryError =
                error instanceof MobilePreviewBundleError &&
                error.message.startsWith('No entry file found.');

            if (!isMissingEntryError || attempt === ENTRY_SYNC_RETRY_COUNT - 1) {
                throw error;
            }

            await new Promise((resolve) =>
                setTimeout(resolve, ENTRY_SYNC_RETRY_DELAY_MS),
            );
        }
    }

    throw new MobilePreviewBundleError(
        'Failed to build the mobile preview bundle after retrying for entry-file sync.',
    );
}
