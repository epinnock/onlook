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
 *   - `@/components/ui/qr-modal` — stubbed to a trivial div so we don't
 *     pull Radix's portal machinery into a portal-less SSR render
 *
 * We render via `renderToStaticMarkup` (same approach as qr-modal's own
 * tests) because `@testing-library/react` and a DOM are not available in
 * this workspace.
 */

import type * as React from 'react';
import { describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

type MockBranch = {
    id: string;
    sandbox?: { providerType?: string };
} | null;

interface MockEditorEngine {
    projectId: string;
    fileSystem: unknown;
    branches: { activeBranch: MockBranch };
    activeSandbox: { session: { provider: unknown } };
}

function makeEngine(
    overrides: {
        activeBranch?: MockBranch;
        provider?: unknown;
    } = {},
): MockEditorEngine {
    return {
        projectId: 'proj_1',
        fileSystem: {},
        branches: {
            activeBranch: overrides.activeBranch ?? {
                id: 'branch_1',
                sandbox: { providerType: 'expo_browser' },
            },
        },
        activeSandbox: {
            session: { provider: overrides.provider ?? null },
        },
    };
}

const engineRef: { current: MockEditorEngine } = {
    current: makeEngine(),
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

mock.module('@/components/store/editor', () => ({
    useEditorEngine: () => engineRef.current,
}));

mock.module('@/hooks/use-mobile-preview-status', () => ({
    useMobilePreviewStatus: (_opts: unknown) => previewRef.current,
}));

mock.module('@/env', () => ({
    env: {
        NEXT_PUBLIC_MOBILE_PREVIEW_URL: 'http://localhost:8787',
    },
}));

// Phase 9 #51 wire-in surface — the button renders an
// `InstallStatusIndicator` next to itself. Stub the hook so the test
// stays agnostic of its internal timers/refs and trivially renders.
// Hold the mock return value in a ref so individual tests can swap it
// without re-loading the module (bun's module table is read-only).
interface InstallStatusForTest {
    status: { kind: 'idle' } | { kind: 'installing'; specifiers: string[] };
    cancel: () => void;
}
const installStatusRef: { current: InstallStatusForTest } = {
    current: {
        status: { kind: 'idle' as const },
        cancel: () => undefined,
    },
};

mock.module('@/hooks/use-install-dependencies', () => ({
    useInstallDependencies: () => installStatusRef.current,
}));

mock.module('@/services/mobile-preview/provider-install-client', () => ({
    createProviderInstallClient: () => ({
        install: async () => ({ ok: true }),
    }),
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
    Button: ({ children, onClick, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
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
        engineRef.current = makeEngine({
            activeBranch: {
                id: 'branch_1',
                sandbox: { providerType: 'codesandbox' },
            },
        });
        previewRef.current = createPreviewHandle();
        const html = renderHtml();
        expect(html).toBe('');
    });

    test('renders nothing when active branch has no sandbox', () => {
        engineRef.current = makeEngine({
            activeBranch: { id: 'branch_1' },
        });
        previewRef.current = createPreviewHandle();
        const html = renderHtml();
        expect(html).toBe('');
    });

    test('renders the button when active branch is ExpoBrowser', () => {
        engineRef.current = makeEngine();
        previewRef.current = createPreviewHandle();
        const html = renderHtml();
        expect(html).toContain('data-testid="preview-on-device-button"');
        expect(html).toContain('aria-label="Preview on device"');
        expect(html).toContain('Preview on device');
        // QrModal stub is rendered but starts closed.
        expect(html).toContain('data-testid="qr-modal-stub"');
        expect(html).toContain('data-open="false"');
    });

    test('passes preview.isOpen through to QrModal', () => {
        engineRef.current = makeEngine();
        // Pre-open the preview handle and check that the stub modal flips
        // its `data-open` marker on the next render. This proves
        // `preview.isOpen` is wired into the QrModal `open` prop.
        previewRef.current = createPreviewHandle({ isOpen: true });
        const html = renderHtml();
        expect(html).toContain('data-testid="qr-modal-stub"');
        expect(html).toContain('data-open="true"');
    });

    test('preview handle exposes open/close/retry callable handlers', async () => {
        engineRef.current = makeEngine();
        previewRef.current = createPreviewHandle();

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

    // Phase 9 #51 wire-in: the button renders an InstallStatusIndicator
    // alongside itself. The default mocked hook returns idle → the pill
    // renders null. Flip the ref to 'installing' and the indicator
    // surfaces next to the button; flipping back to 'idle' restores the
    // no-UI-noise contract.
    test('InstallStatusIndicator renders beside the button', () => {
        engineRef.current = makeEngine();
        previewRef.current = createPreviewHandle();
        installStatusRef.current = {
            status: {
                kind: 'installing' as const,
                specifiers: ['lodash'],
            },
            cancel: () => undefined,
        };
        try {
            const html = renderHtml();
            expect(html).toContain('data-testid="install-status-indicator"');
            expect(html).toContain('Installing');
            expect(html).toContain('lodash');
            // Button still present alongside the pill
            expect(html).toContain('data-testid="preview-on-device-button"');
        } finally {
            installStatusRef.current = {
                status: { kind: 'idle' as const },
                cancel: () => undefined,
            };
        }
    });

    test('InstallStatusIndicator renders nothing when idle', () => {
        engineRef.current = makeEngine();
        previewRef.current = createPreviewHandle();
        // default install status is idle
        const html = renderHtml();
        expect(html).not.toContain('data-testid="install-status-indicator"');
        // Button still present
        expect(html).toContain('data-testid="preview-on-device-button"');
    });
});
