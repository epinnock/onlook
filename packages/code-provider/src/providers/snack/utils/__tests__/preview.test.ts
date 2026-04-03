import { describe, expect, it, mock } from 'bun:test';
import {
    buildSnackQrCodeData,
    getSnackExpoGoUrl,
    getSnackPreviewUrlForProvider,
    getSnackWebPreviewUrl,
    isSnackPreviewReady,
} from '../preview';

// ---------------------------------------------------------------------------
// getSnackWebPreviewUrl
// ---------------------------------------------------------------------------

describe('getSnackWebPreviewUrl', () => {
    it('returns the embedded preview URL with preview and platform params', () => {
        const url = getSnackWebPreviewUrl('abc123');
        expect(url).toBe(
            'https://snack.expo.dev/embedded/@snack/abc123?preview=true&platform=web',
        );
    });

    it('appends sdkVersion when provided', () => {
        const url = getSnackWebPreviewUrl('abc123', '51.0.0');
        expect(url).toBe(
            'https://snack.expo.dev/embedded/@snack/abc123?preview=true&platform=web&sdkVersion=51.0.0',
        );
    });

    it('omits sdkVersion when undefined', () => {
        const url = getSnackWebPreviewUrl('xyz');
        expect(url).not.toContain('sdkVersion');
    });
});

// ---------------------------------------------------------------------------
// getSnackExpoGoUrl
// ---------------------------------------------------------------------------

describe('getSnackExpoGoUrl', () => {
    it('delegates to snack.getUrlAsync()', async () => {
        const fakeSnack = {
            getUrlAsync: mock(() => Promise.resolve('exp://example.com/@snack/abc')),
        };
        const result = await getSnackExpoGoUrl(fakeSnack);
        expect(result).toBe('exp://example.com/@snack/abc');
        expect(fakeSnack.getUrlAsync).toHaveBeenCalledTimes(1);
    });
});

// ---------------------------------------------------------------------------
// buildSnackQrCodeData
// ---------------------------------------------------------------------------

describe('buildSnackQrCodeData', () => {
    it('returns the URL string unchanged', () => {
        const expoUrl = 'exp://example.com/@snack/abc';
        expect(buildSnackQrCodeData(expoUrl)).toBe(expoUrl);
    });
});

// ---------------------------------------------------------------------------
// isSnackPreviewReady
// ---------------------------------------------------------------------------

describe('isSnackPreviewReady', () => {
    it('returns true on HTTP 200', async () => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = mock(() =>
            Promise.resolve(new Response('ok', { status: 200 })),
        );
        try {
            const ready = await isSnackPreviewReady('https://snack.expo.dev/embedded/@snack/abc');
            expect(ready).toBe(true);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it('returns false on non-200 status', async () => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = mock(() =>
            Promise.resolve(new Response('not found', { status: 404 })),
        );
        try {
            const ready = await isSnackPreviewReady('https://snack.expo.dev/embedded/@snack/abc');
            expect(ready).toBe(false);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });

    it('returns false on network error', async () => {
        const originalFetch = globalThis.fetch;
        globalThis.fetch = mock(() => Promise.reject(new Error('network failure')));
        try {
            const ready = await isSnackPreviewReady('https://snack.expo.dev/embedded/@snack/abc');
            expect(ready).toBe(false);
        } finally {
            globalThis.fetch = originalFetch;
        }
    });
});

// ---------------------------------------------------------------------------
// getSnackPreviewUrlForProvider
// ---------------------------------------------------------------------------

describe('getSnackPreviewUrlForProvider', () => {
    it('strips "snack-" prefix and builds preview URL', () => {
        const url = getSnackPreviewUrlForProvider('snack-abc123');
        expect(url).toBe(
            'https://snack.expo.dev/embedded/@snack/abc123?preview=true&platform=web',
        );
    });

    it('uses sandboxId as-is when it does not start with "snack-"', () => {
        const url = getSnackPreviewUrlForProvider('my-sandbox');
        expect(url).toBe(
            'https://snack.expo.dev/embedded/@snack/my-sandbox?preview=true&platform=web',
        );
    });
});
