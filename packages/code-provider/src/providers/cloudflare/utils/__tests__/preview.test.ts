import { afterEach, describe, expect, it, mock } from 'bun:test';
import {
    buildPreviewUrl,
    getPreviewUrl,
    isPreviewReady,
    waitForPreview,
    type SandboxPreviewAPI,
} from '../preview';

function createMockSandbox(previewUrl = 'https://mock-preview.example.com'): SandboxPreviewAPI {
    return {
        getPreviewUrl: mock(() => previewUrl),
        status: mock(() => Promise.resolve({ state: 'running' })),
    };
}

const originalFetch = globalThis.fetch;

afterEach(() => {
    globalThis.fetch = originalFetch;
});

describe('getPreviewUrl', () => {
    it('delegates to sandbox.getPreviewUrl', () => {
        const sandbox = createMockSandbox('https://sandbox-123-3000.containers.dev');

        const result = getPreviewUrl(sandbox, 3000);

        expect(result).toBe('https://sandbox-123-3000.containers.dev');
        expect(sandbox.getPreviewUrl).toHaveBeenCalledWith(3000);
    });
});

describe('buildPreviewUrl', () => {
    it('constructs correct URL format', () => {
        const result = buildPreviewUrl('abc-123', 8080);

        expect(result).toBe('https://abc-123-8080.containers.dev');
    });
});

describe('isPreviewReady', () => {
    it('returns true on 200 response', async () => {
        globalThis.fetch = mock(() =>
            Promise.resolve(new Response(null, { status: 200 })),
        ) as typeof fetch;

        const result = await isPreviewReady('https://example.com');

        expect(result).toBe(true);
    });

    it('returns false on network error', async () => {
        globalThis.fetch = mock(() =>
            Promise.reject(new Error('network error')),
        ) as typeof fetch;

        const result = await isPreviewReady('https://example.com');

        expect(result).toBe(false);
    });

    it('returns false on non-ok response', async () => {
        globalThis.fetch = mock(() =>
            Promise.resolve(new Response(null, { status: 503 })),
        ) as typeof fetch;

        const result = await isPreviewReady('https://example.com');

        expect(result).toBe(false);
    });
});

describe('waitForPreview', () => {
    it('returns false on timeout', async () => {
        globalThis.fetch = mock(() =>
            Promise.reject(new Error('not ready')),
        ) as typeof fetch;

        const result = await waitForPreview('https://example.com', 100);

        expect(result).toBe(false);
    });
});
