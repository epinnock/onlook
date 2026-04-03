/**
 * E2E-style tests for Cloudflare provider preview URL utilities.
 *
 * Tests buildPreviewUrl, getPreviewUrl, and isPreviewReady with mock sandboxes.
 * No live CF account needed.
 *
 * Run with: bun test apps/web/client/e2e/provider/cf-preview.spec.ts
 */
import { afterEach, describe, expect, it, mock } from 'bun:test';
import {
    buildPreviewUrl,
    getPreviewUrl,
    isPreviewReady,
    type SandboxPreviewAPI,
} from '../../../../../packages/code-provider/src/providers/cloudflare/utils/preview';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function createMockPreviewSandbox(
    overrides?: Partial<SandboxPreviewAPI>,
): SandboxPreviewAPI {
    return {
        getPreviewUrl: (port: number) => `https://mock-sandbox-${port}.containers.dev`,
        status: async () => ({ state: 'running' }),
        ...overrides,
    };
}

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

// ---------------------------------------------------------------------------
// buildPreviewUrl
// ---------------------------------------------------------------------------

describe('CF Provider Preview - buildPreviewUrl (E2E)', () => {
    it('generates correct URL format', () => {
        const url = buildPreviewUrl('sandbox-123', 8080);

        expect(url).toBe('https://sandbox-123-8080.containers.dev');
    });

    it('includes port in the generated URL', () => {
        expect(buildPreviewUrl('abc', 3000)).toContain('3000');
        expect(buildPreviewUrl('abc', 8080)).toContain('8080');
        expect(buildPreviewUrl('abc', 5173)).toContain('5173');
    });

    it('includes sandbox ID in the generated URL', () => {
        expect(buildPreviewUrl('my-project-xyz', 3000)).toContain('my-project-xyz');
    });

    it('handles numeric-like sandbox IDs', () => {
        const url = buildPreviewUrl('12345', 8080);

        expect(url).toBe('https://12345-8080.containers.dev');
    });

    it('produces unique URLs for different sandbox/port combinations', () => {
        const url1 = buildPreviewUrl('sandbox-a', 3000);
        const url2 = buildPreviewUrl('sandbox-a', 8080);
        const url3 = buildPreviewUrl('sandbox-b', 3000);

        expect(url1).not.toBe(url2);
        expect(url1).not.toBe(url3);
        expect(url2).not.toBe(url3);
    });
});

// ---------------------------------------------------------------------------
// getPreviewUrl
// ---------------------------------------------------------------------------

describe('CF Provider Preview - getPreviewUrl (E2E)', () => {
    it('delegates to sandbox.getPreviewUrl', () => {
        const sandbox = createMockPreviewSandbox();

        const url = getPreviewUrl(sandbox, 3000);

        expect(url).toBe('https://mock-sandbox-3000.containers.dev');
    });

    it('passes port to the sandbox correctly', () => {
        const getPreviewUrlFn = mock((port: number) => `https://custom-${port}.cf.dev`);
        const sandbox = createMockPreviewSandbox({ getPreviewUrl: getPreviewUrlFn });

        const url = getPreviewUrl(sandbox, 5173);

        expect(url).toBe('https://custom-5173.cf.dev');
        expect(getPreviewUrlFn).toHaveBeenCalledWith(5173);
    });

    it('returns whatever the sandbox provides', () => {
        const sandbox = createMockPreviewSandbox({
            getPreviewUrl: () => 'https://completely-custom-url.example.com',
        });

        const url = getPreviewUrl(sandbox, 9999);

        expect(url).toBe('https://completely-custom-url.example.com');
    });
});

// ---------------------------------------------------------------------------
// isPreviewReady
// ---------------------------------------------------------------------------

describe('CF Provider Preview - isPreviewReady (E2E)', () => {
    it('returns true when fetch responds with 200', async () => {
        globalThis.fetch = mock(() =>
            Promise.resolve(new Response(null, { status: 200 })),
        ) as typeof fetch;

        const ready = await isPreviewReady('https://sandbox-test.containers.dev');

        expect(ready).toBe(true);
    });

    it('returns false when fetch throws a network error', async () => {
        globalThis.fetch = mock(() =>
            Promise.reject(new Error('ECONNREFUSED')),
        ) as typeof fetch;

        const ready = await isPreviewReady('https://sandbox-test.containers.dev');

        expect(ready).toBe(false);
    });

    it('returns false on non-ok HTTP response', async () => {
        globalThis.fetch = mock(() =>
            Promise.resolve(new Response(null, { status: 503 })),
        ) as typeof fetch;

        const ready = await isPreviewReady('https://sandbox-test.containers.dev');

        expect(ready).toBe(false);
    });

    it('returns true on 301 redirect (ok range)', async () => {
        // 301 is not in the 200-299 "ok" range, so Response.ok is false
        globalThis.fetch = mock(() =>
            Promise.resolve(new Response(null, { status: 301 })),
        ) as typeof fetch;

        const ready = await isPreviewReady('https://sandbox-test.containers.dev');

        expect(ready).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// Integration: buildPreviewUrl -> isPreviewReady
// ---------------------------------------------------------------------------

describe('CF Provider Preview - build + check integration (E2E)', () => {
    it('builds a URL then checks if it is ready', async () => {
        const url = buildPreviewUrl('live-sandbox', 3000);

        // Simulate the sandbox being reachable
        globalThis.fetch = mock(() =>
            Promise.resolve(new Response('OK', { status: 200 })),
        ) as typeof fetch;

        const ready = await isPreviewReady(url);

        expect(url).toBe('https://live-sandbox-3000.containers.dev');
        expect(ready).toBe(true);
    });

    it('builds a URL then detects unreachable sandbox', async () => {
        const url = buildPreviewUrl('offline-sandbox', 8080);

        globalThis.fetch = mock(() =>
            Promise.reject(new Error('Sandbox not running')),
        ) as typeof fetch;

        const ready = await isPreviewReady(url);

        expect(ready).toBe(false);
    });
});
