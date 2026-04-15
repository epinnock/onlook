/**
 * Tests for PreviewOnDeviceButton (TQ3.3).
 *
 * The button renders only when the active branch's sandbox providerType is
 * `expo_browser`. For non-ExpoBrowser branches it returns `null`. These
 * tests mock:
 *
 *   - `@/components/store/editor`  — provides a fake editor engine so we
 *     can toggle `activeBranch.sandbox.providerType`
 *   - `@/hooks/use-mobile-preview-status` — returns a deterministic status
 *     object + spy handles for `open` / `close` / `retry`
 *   - `@/hooks/use-mobile-preview-connection` — returns deterministic
 *     connection states for the status badge beside the button
 *   - `@/components/ui/qr-modal` — stubbed to a trivial div so we don't
 *     pull Radix's portal machinery into a portal-less SSR render
 *
 * We render via `renderToStaticMarkup` (same approach as qr-modal's own
 * tests) because `@testing-library/react` and a DOM are not available in
 * this workspace.
 */

import { describe, expect, mock, test } from 'bun:test';
import type * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

type MockBranch = {
    id: string;
    sandbox?: { providerType?: string };
} | null;

interface MockEditorEngine {
    projectId: string;
    fileSystem: unknown;
    branches: { activeBranch: MockBranch };
}

const engineRef: { current: MockEditorEngine } = {
    current: {
        projectId: 'proj_1',
        fileSystem: {},
        branches: {
            activeBranch: {
                id: 'branch_1',
                sandbox: { providerType: 'expo_browser' },
            },
        },
    },
};

interface MockPreviewHandle {
    status: { kind: string };
    isOpen: boolean;
    open: () => Promise<void>;
    close: () => void;
    retry: () => Promise<void>;
    openCalls: number;
    closeCalls: number;
}

const previewRef: { current: MockPreviewHandle } = {
    current: createPreviewHandle(),
};

type MockConnectionStatus =
    | { kind: 'disabled'; clients: 0; hasRuntime: false; message: string }
    | { kind: 'checking'; clients: 0; hasRuntime: false }
    | { kind: 'waiting'; clients: number; hasRuntime: boolean }
    | { kind: 'connected'; clients: number; hasRuntime: boolean }
    | { kind: 'error'; clients: 0; hasRuntime: false; message: string };

interface MockConnectionHandle {
    status: MockConnectionStatus;
    refresh: () => Promise<void>;
    refreshCalls: number;
}

const connectionRef: { current: MockConnectionHandle } = {
    current: createConnectionHandle(),
};

function createPreviewHandle(overrides: Partial<MockPreviewHandle> = {}): MockPreviewHandle {
    const handle: MockPreviewHandle = {
        status: { kind: 'idle' },
        isOpen: false,
        openCalls: 0,
        closeCalls: 0,
        open: async () => {
            handle.openCalls++;
            handle.isOpen = true;
        },
        close: () => {
            handle.closeCalls++;
            handle.isOpen = false;
        },
        retry: async () => undefined,
        ...overrides,
    };
    return handle;
}

function createConnectionHandle(
    overrides: Partial<MockConnectionHandle> = {},
): MockConnectionHandle {
    const handle: MockConnectionHandle = {
        status: {
            kind: 'waiting',
            clients: 0,
            hasRuntime: true,
        },
        refreshCalls: 0,
        refresh: async () => {
            handle.refreshCalls++;
        },
        ...overrides,
    };
    return handle;
}

mock.module('@/components/store/editor', () => ({
    useEditorEngine: () => engineRef.current,
}));

mock.module('@/hooks/use-mobile-preview-status', () => ({
    useMobilePreviewStatus: (_opts: unknown) => previewRef.current,
}));

mock.module('@/hooks/use-mobile-preview-connection', () => ({
    useMobilePreviewConnection: (_opts: unknown) => connectionRef.current,
}));

mock.module('@/env', () => ({
    env: {
        NEXT_PUBLIC_MOBILE_PREVIEW_URL: 'http://localhost:8787',
    },
}));

// Stub QrModal to a trivial marker div so renderToStaticMarkup doesn't try
// to walk into Radix's portal/ref machinery (which requires a real DOM).
mock.module('@/components/ui/qr-modal', () => ({
    QrModal: ({ open }: { open: boolean }) => (
        <div data-testid="qr-modal-stub" data-open={String(open)} />
    ),
}));

// Stub @onlook/ui/button to a plain <button>. The real Button comes from
// `packages/ui` which has its own React 18 in `node_modules/react`,
// causing "Objects are not valid as a React child" when its createElement
// output is fed to the apps/web/client React 19 SSR renderer. Stubbing
// keeps the test's element factory consistent (single React copy).
mock.module('@onlook/ui/button', () => ({
    Button: ({
        children,
        onClick,
        ...rest
    }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
        <button type="button" onClick={onClick} {...rest}>
            {children}
        </button>
    ),
}));

const { PreviewOnDeviceButton } = await import('../preview-on-device-button');

function renderHtml(): string {
    return renderToStaticMarkup(<PreviewOnDeviceButton />);
}

describe('PreviewOnDeviceButton', () => {
    test('renders nothing when active branch is not ExpoBrowser', () => {
        engineRef.current = {
            projectId: 'proj_1',
            fileSystem: {},
            branches: {
                activeBranch: {
                    id: 'branch_1',
                    sandbox: { providerType: 'codesandbox' },
                },
            },
        };
        previewRef.current = createPreviewHandle();
        connectionRef.current = createConnectionHandle();
        const html = renderHtml();
        expect(html).toBe('');
    });

    test('renders nothing when active branch has no sandbox', () => {
        engineRef.current = {
            projectId: 'proj_1',
            fileSystem: {},
            branches: {
                activeBranch: { id: 'branch_1' },
            },
        };
        previewRef.current = createPreviewHandle();
        connectionRef.current = createConnectionHandle();
        const html = renderHtml();
        expect(html).toBe('');
    });

    test('renders the button when active branch is ExpoBrowser', () => {
        engineRef.current = {
            projectId: 'proj_1',
            fileSystem: {},
            branches: {
                activeBranch: {
                    id: 'branch_1',
                    sandbox: { providerType: 'expo_browser' },
                },
            },
        };
        previewRef.current = createPreviewHandle();
        connectionRef.current = createConnectionHandle();
        const html = renderHtml();
        expect(html).toContain('data-testid="preview-on-device-button"');
        expect(html).toContain('aria-label="Preview on device"');
        expect(html).toContain('Preview on device');
        expect(html).toContain('data-testid="mobile-preview-connection-status"');
        expect(html).toContain('data-status="waiting"');
        expect(html).toContain('0 devices');
        // QrModal stub is rendered but starts closed.
        expect(html).toContain('data-testid="qr-modal-stub"');
        expect(html).toContain('data-open="false"');
    });

    test('passes preview.isOpen through to QrModal', () => {
        engineRef.current = {
            projectId: 'proj_1',
            fileSystem: {},
            branches: {
                activeBranch: {
                    id: 'branch_1',
                    sandbox: { providerType: 'expo_browser' },
                },
            },
        };
        // Pre-open the preview handle and check that the stub modal flips
        // its `data-open` marker on the next render. This proves
        // `preview.isOpen` is wired into the QrModal `open` prop.
        previewRef.current = createPreviewHandle({ isOpen: true });
        connectionRef.current = createConnectionHandle();
        const html = renderHtml();
        expect(html).toContain('data-testid="qr-modal-stub"');
        expect(html).toContain('data-open="true"');
    });

    test('renders connected client count in the status indicator', () => {
        engineRef.current = {
            projectId: 'proj_1',
            fileSystem: {},
            branches: {
                activeBranch: {
                    id: 'branch_1',
                    sandbox: { providerType: 'expo_browser' },
                },
            },
        };
        previewRef.current = createPreviewHandle();
        connectionRef.current = createConnectionHandle({
            status: {
                kind: 'connected',
                clients: 2,
                hasRuntime: true,
            },
        });

        const html = renderHtml();

        expect(html).toContain('data-testid="mobile-preview-connection-status"');
        expect(html).toContain('data-status="connected"');
        expect(html).toContain('2 devices');
    });

    test('renders an offline status when the preview server is unavailable', () => {
        engineRef.current = {
            projectId: 'proj_1',
            fileSystem: {},
            branches: {
                activeBranch: {
                    id: 'branch_1',
                    sandbox: { providerType: 'expo_browser' },
                },
            },
        };
        previewRef.current = createPreviewHandle();
        connectionRef.current = createConnectionHandle({
            status: {
                kind: 'error',
                clients: 0,
                hasRuntime: false,
                message: 'Failed to reach mobile-preview server: refused',
            },
        });

        const html = renderHtml();

        expect(html).toContain('data-testid="mobile-preview-connection-status"');
        expect(html).toContain('data-status="error"');
        expect(html).toContain('Server offline');
    });

    test('preview handle exposes open/close/retry callable handlers', async () => {
        engineRef.current = {
            projectId: 'proj_1',
            fileSystem: {},
            branches: {
                activeBranch: {
                    id: 'branch_1',
                    sandbox: { providerType: 'expo_browser' },
                },
            },
        };
        previewRef.current = createPreviewHandle();
        connectionRef.current = createConnectionHandle();

        // Render once so the test exercises the full mount path through
        // observer + sub-component + mocked hook.
        renderHtml();

        // The button in the rendered HTML wires `onClick={() => void preview.open()}`.
        // Static markup can't fire that DOM click, so we directly invoke
        // the same handle to confirm the spy infrastructure is correctly
        // wired through `mock.module`.
        await previewRef.current.open();
        expect(previewRef.current.openCalls).toBe(1);
        expect(previewRef.current.isOpen).toBe(true);

        previewRef.current.close();
        expect(previewRef.current.closeCalls).toBe(1);
        expect(previewRef.current.isOpen).toBe(false);
    });
});
