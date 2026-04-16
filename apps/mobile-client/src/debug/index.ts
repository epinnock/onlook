/**
 * Debug utilities for the Onlook mobile client.
 *
 * Re-exports from per-module files so consumers can import from `../debug`.
 */

export { DebugInfoCollector, debugInfoCollector } from './debugInfo';
export type { DebugInfo } from './debugInfo';

export { ConsoleRelay, consoleRelay } from './consoleRelay';
export type { ConsoleEntry, ConsoleLevel } from './consoleRelay';

export { FetchPatch, fetchPatch } from './fetchPatch';
export type { NetworkEntry } from './fetchPatch';

export { XhrPatch, xhrPatch } from './xhrPatch';

export { ExceptionCatcher, exceptionCatcher } from './exceptionCatcher';
export type { ExceptionEntry } from './exceptionCatcher';

export { NetworkStreamer } from './networkStreamer';
export type { NetworkStreamerSources, NetworkStreamerOptions } from './networkStreamer';

export { ConsoleStreamer } from './consoleStreamer';
