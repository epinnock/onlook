import type { SandboxTemplate } from '@onlook/models';
import { getSnackWebPreviewUrl } from './snack';

export enum Templates {
    BLANK = 'BLANK',
    EMPTY_NEXTJS = 'EMPTY_NEXTJS',
}

export const SandboxTemplates: Record<Templates, SandboxTemplate> = {
    BLANK: {
        id: 'xzsy8c',
        port: 3000,
    },
    EMPTY_NEXTJS: {
        id: 'pt_EphPmsurimGCQdiB44wa7s',
        port: 3000,
    },
};

export const CSB_PREVIEW_TASK_NAME = 'dev';
export const CSB_DOMAIN = 'csb.app';

export function getSandboxPreviewUrl(sandboxId: string, port: number) {
    return `https://${sandboxId}-${port}.${CSB_DOMAIN}`;
}

/**
 * Snack-aware preview URL resolver.
 *
 * If `sandboxId` starts with `"snack-"`, returns the Snack web player URL
 * (port is ignored). Otherwise falls through to the CodeSandbox URL.
 */
export function getPreviewUrl(sandboxId: string, port: number): string {
    if (sandboxId.startsWith('snack-')) {
        const snackId = sandboxId.slice('snack-'.length);
        return getSnackWebPreviewUrl(snackId);
    }
    return getSandboxPreviewUrl(sandboxId, port);
}
