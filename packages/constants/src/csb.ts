import type { SandboxTemplate } from '@onlook/models';

const DEFAULT_EMPTY_NEXTJS_TEMPLATE_ID = 'pt_EphPmsurimGCQdiB44wa7s';
const EXPO_WEB_TEMPLATE_ID = process.env.ONLOOK_CSB_EXPO_TEMPLATE_ID;
const EXPO_WEB_TEMPLATE_PORT = Number.parseInt(
    process.env.ONLOOK_CSB_EXPO_TEMPLATE_PORT ?? '8081',
    10,
);

export enum Templates {
    BLANK = 'BLANK',
    EMPTY_NEXTJS = 'EMPTY_NEXTJS',
    EXPO_WEB = 'EXPO_WEB',
}

export const SandboxTemplates: Record<Templates, SandboxTemplate> = {
    BLANK: {
        id: 'xzsy8c',
        port: 3000,
    },
    EMPTY_NEXTJS: {
        id: DEFAULT_EMPTY_NEXTJS_TEMPLATE_ID,
        port: 3000,
    },
    EXPO_WEB: {
        // Falls back to EMPTY_NEXTJS until an Expo template ID is configured.
        id: EXPO_WEB_TEMPLATE_ID ?? DEFAULT_EMPTY_NEXTJS_TEMPLATE_ID,
        port: EXPO_WEB_TEMPLATE_ID ? EXPO_WEB_TEMPLATE_PORT : 3000,
    },
};

export const CSB_PREVIEW_TASK_NAME = 'dev';
export const CSB_DOMAIN = 'csb.app';

export function getSandboxPreviewUrl(sandboxId: string, port: number) {
    return `https://${sandboxId}-${port}.${CSB_DOMAIN}`;
}
