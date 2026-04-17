import { IMAGE_ASSET_EXTENSIONS } from './constants';

const IMAGE_ASSET_MIME_TYPES = new Map<string, string>([
    ['.avif', 'image/avif'],
    ['.bmp', 'image/bmp'],
    ['.gif', 'image/gif'],
    ['.jpeg', 'image/jpeg'],
    ['.jpg', 'image/jpeg'],
    ['.png', 'image/png'],
    ['.svg', 'image/svg+xml'],
    ['.webp', 'image/webp'],
]);

export function isImageAssetPath(filePath: string): boolean {
    const lowerCasedPath = filePath.toLowerCase();
    return IMAGE_ASSET_EXTENSIONS.some((extension) =>
        lowerCasedPath.endsWith(extension),
    );
}

export function inlineImageAsset(
    filePath: string,
    content: string | Uint8Array,
): string {
    const bytes =
        typeof content === 'string' ? new TextEncoder().encode(content) : content;
    const base64 = btoa(
        Array.from(bytes)
            .map((byte) => String.fromCharCode(byte))
            .join(''),
    );

    return `data:${getImageAssetMimeType(filePath)};base64,${base64}`;
}

export function buildInlineAssetModuleCode(assetDataUrl: string): string {
    return [
        `const asset = ${JSON.stringify({ uri: assetDataUrl })};`,
        'module.exports = asset;',
        'module.exports.default = asset;',
        'module.exports.__esModule = true;',
    ].join('\n');
}

function getImageAssetMimeType(filePath: string): string {
    const lowerCasedPath = filePath.toLowerCase();

    for (const [extension, mimeType] of IMAGE_ASSET_MIME_TYPES) {
        if (lowerCasedPath.endsWith(extension)) {
            return mimeType;
        }
    }

    return 'application/octet-stream';
}
