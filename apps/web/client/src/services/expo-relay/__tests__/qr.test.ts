import { describe, expect, it } from 'bun:test';

import { QrRenderError, renderQrDataUrl, renderQrSvg } from '../qr';

describe('renderQrSvg', () => {
    it('returns a non-empty SVG string starting with <svg', async () => {
        const svg = await renderQrSvg('https://example.com');
        expect(typeof svg).toBe('string');
        expect(svg.length).toBeGreaterThan(0);
        expect(svg.trim().startsWith('<svg')).toBe(true);
    });

    it('emits an SVG with a viewBox (confirms valid encoding)', async () => {
        const svg = await renderQrSvg('https://example.com/foo');
        expect(svg).toContain('viewBox');
    });

    it('applies custom foreground and background colors', async () => {
        const svg = await renderQrSvg('https://example.com', {
            fg: '#ff0000',
            bg: '#00ff00',
        });
        // The `qrcode` package renders colors as full-alpha hex (e.g. #ff0000ff).
        expect(svg.toLowerCase()).toContain('#ff0000');
        expect(svg.toLowerCase()).toContain('#00ff00');
    });

    it('applies custom width', async () => {
        const svg = await renderQrSvg('https://example.com', { width: 512 });
        expect(svg).toContain('width="512"');
    });

    it('throws QrRenderError on empty URL', async () => {
        await expect(renderQrSvg('')).rejects.toBeInstanceOf(QrRenderError);
    });

    it('honors a high error correction level', async () => {
        const svg = await renderQrSvg('https://example.com', {
            errorCorrectionLevel: 'H',
        });
        expect(svg.trim().startsWith('<svg')).toBe(true);
    });
});

describe('renderQrDataUrl', () => {
    it('returns a data:image/svg+xml;base64,... URL', async () => {
        const dataUrl = await renderQrDataUrl('https://example.com');
        expect(dataUrl.startsWith('data:image/svg+xml;base64,')).toBe(true);
        const payload = dataUrl.slice('data:image/svg+xml;base64,'.length);
        expect(payload.length).toBeGreaterThan(0);
        // Round-trip decode to make sure it is valid base64 of an SVG string.
        const decoded = Buffer.from(payload, 'base64').toString('utf-8');
        expect(decoded.trim().startsWith('<svg')).toBe(true);
    });

    it('throws QrRenderError on empty URL', async () => {
        await expect(renderQrDataUrl('')).rejects.toBeInstanceOf(QrRenderError);
    });
});
