/**
 * @onlook/browser-metro — in-browser bundler for the ExpoBrowser preview.
 *
 * Wave C scaffold (§1.1 of plans/expo-browser-implementation.md).
 *
 * This is a minimal, working stub of the public API that the preview
 * pipeline (Wave H §1.3) and the BrowserTask (TA.6) bind to. The Sprint
 * 0 + Wave A provider already supports the contract via attachBundler();
 * this package fills in the actual bundler.
 *
 * The full Metro-compatible bundler (Sucrase transform + module resolver
 * + dependency graph + React Refresh runtime) is vendored from
 * github.com/RapidNative/reactnative-run (MIT) in a follow-up Sprint
 * because it's a large drop. For Sprint 0 / Wave C we ship:
 *
 *   1. The public BrowserMetro class with the full method surface
 *   2. A working but minimal pipeline that:
 *        - reads file contents from a CodeFileSystem-shaped fs
 *        - transpiles each file with Sucrase (jsx + ts)
 *        - emits a single concatenated module map keyed by file path
 *        - broadcasts the result on a BroadcastChannel
 *   3. Stubs for HMR (React Refresh boundaries) — Wave H wires the
 *      runtime side
 *
 * Real npm package resolution (the ESM CDN fetch path) lands in Wave 2
 * once the cf-esm-cache Worker is up. For now, all bare imports are
 * left as-is in the output and resolved by the preview iframe at runtime
 * via an import map.
 */

export { BrowserMetro } from './host/index';
export type {
    BundleResult,
    BundleError,
    BrowserMetroOptions,
    Vfs,
} from './host/types';
