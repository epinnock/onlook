/**
 * Deep link utilities for the Onlook mobile client.
 *
 * Re-exports from `./parse` and `./handler` so consumers can import from
 * `../deepLink`.
 */

export { parseOnlookDeepLink, ParsedDeepLinkSchema } from './parse';
export type { ParsedDeepLink } from './parse';
export { registerDeepLinkHandler, useDeepLinkHandler } from './handler';
