/**
 * Deep link utilities for the Onlook mobile client.
 *
 * Re-exports from `./parse`, `./handler`, and `./qrResolver` so consumers can
 * import from `../deepLink`.
 */

export { parseOnlookDeepLink, ParsedDeepLinkSchema } from './parse';
export type { ParsedDeepLink } from './parse';
export { registerDeepLinkHandler, useDeepLinkHandler } from './handler';
export { resolveQrCode, useQrResolver } from './qrResolver';
export type { QrResolveResult } from './qrResolver';
