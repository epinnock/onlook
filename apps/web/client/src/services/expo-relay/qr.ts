/**
 * Thin wrapper around the `qrcode` package for SVG rendering.
 *
 * This module is the only place in the editor that should import `qrcode`
 * directly — UI code should go through `renderQrSvg` / `renderQrDataUrl`
 * so options stay consistent across scan surfaces (TQ3.x).
 */
import QRCode from 'qrcode';

export interface QrRenderOptions {
    /** Foreground color hex. Default '#000000'. */
    fg?: string;
    /** Background color hex. Default '#ffffff'. */
    bg?: string;
    /** Width in px. Default 256. */
    width?: number;
    /** Quiet zone (margin) in modules. Default 4. */
    margin?: number;
    /** Error correction level. Default 'M'. */
    errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H';
}

/** Thrown when the underlying `qrcode` call fails (e.g. empty input). */
export class QrRenderError extends Error {
    public readonly cause?: unknown;
    constructor(message: string, cause?: unknown) {
        super(message);
        this.name = 'QrRenderError';
        this.cause = cause;
    }
}

const DEFAULTS: Required<QrRenderOptions> = {
    fg: '#000000',
    bg: '#ffffff',
    width: 256,
    margin: 4,
    errorCorrectionLevel: 'M',
};

/**
 * Render an SVG string for the given URL. Pure async function.
 * Returns the SVG markup as a string (ready for innerHTML or img src=data:...).
 *
 * Throws `QrRenderError` if the underlying encoder fails (e.g. empty input).
 */
export async function renderQrSvg(url: string, opts: QrRenderOptions = {}): Promise<string> {
    if (typeof url !== 'string' || url.length === 0) {
        throw new QrRenderError('renderQrSvg: url must be a non-empty string');
    }
    const merged: Required<QrRenderOptions> = { ...DEFAULTS, ...opts };
    try {
        const svg = await QRCode.toString(url, {
            type: 'svg',
            color: { dark: merged.fg, light: merged.bg },
            width: merged.width,
            margin: merged.margin,
            errorCorrectionLevel: merged.errorCorrectionLevel,
        });
        return svg;
    } catch (err) {
        throw new QrRenderError(
            `renderQrSvg: failed to render QR code: ${(err as Error).message ?? String(err)}`,
            err,
        );
    }
}

/**
 * Convenience: returns a `data:image/svg+xml;base64,...` URL containing the SVG,
 * suitable for an `<img src>` attribute.
 */
export async function renderQrDataUrl(url: string, opts: QrRenderOptions = {}): Promise<string> {
    const svg = await renderQrSvg(url, opts);
    const base64 = encodeSvgBase64(svg);
    return `data:image/svg+xml;base64,${base64}`;
}

/**
 * Base64-encode an SVG string. Works in both Node (Buffer) and browser
 * (btoa) without pulling in a polyfill. We route through UTF-8 bytes so
 * non-ASCII characters in the SVG (if the underlying encoder ever emits
 * them) don't trip up `btoa`.
 */
function encodeSvgBase64(svg: string): string {
    if (typeof Buffer !== 'undefined') {
        return Buffer.from(svg, 'utf-8').toString('base64');
    }
    // Browser fallback: encode UTF-8 bytes then base64.
    const bytes = new TextEncoder().encode(svg);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]!);
    }
    return btoa(binary);
}
