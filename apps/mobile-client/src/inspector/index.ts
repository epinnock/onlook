/**
 * Inspector — JS-side tap handler and helpers used by the Onlook inspector
 * flow (device tap → editor cursor jump).
 *
 * Re-exports from per-module files so consumers can import from `../inspector`.
 */

export { TapHandler, extractSource } from './tapHandler';
export type { TapSource, TapListener, TapHandlerOptions } from './tapHandler';
