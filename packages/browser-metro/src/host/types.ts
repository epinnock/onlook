/**
 * Public types for @onlook/browser-metro.
 */

/**
 * Which preview surface the bundle targets.
 *
 * - `expo-go`        — standard Expo Go preview (no Onlook inspector wiring).
 * - `onlook-client`  — Onlook's native mobile client; in dev mode the bundler
 *                       injects `__source` metadata so the inspector can map
 *                       taps back to source locations (MC4.12 / MC4.13).
 */
export type BundleTarget = 'expo-go' | 'onlook-client';

/**
 * Minimal filesystem interface the bundler expects. Matches the relevant
 * subset of @onlook/file-system's CodeFileSystem so the host package can
 * pass its existing instance directly.
 */
export interface Vfs {
    listAll(): Promise<Array<{ path: string; type: 'file' | 'directory' }>>;
    readFile(path: string): Promise<string | Uint8Array>;
}

export interface BrowserMetroOptions {
    /** The local filesystem to bundle from. */
    vfs: Vfs;
    /**
     * URL of the ESM CDN that resolves bare npm package imports. Wave 2
     * stands up our own (cf-esm-cache); until then, set to a public
     * fallback like esm.sh.
     */
    esmUrl: string;
    /**
     * BroadcastChannel name to publish bundle events on. The preview
     * service worker (Wave H §1.3) listens on the same channel and
     * serves the latest bundle to /preview/<branchId>/bundle.js.
     */
    broadcastChannel?: string;
    /**
     * Which preview surface this bundler targets. Defaults to `'expo-go'`.
     *
     * When set to `'onlook-client'` **and** `isDev` is true, the pipeline
     * injects `__source` metadata into every JSX element so the Onlook
     * inspector can resolve taps to source locations (MC4.13).
     */
    target?: BundleTarget;
    /**
     * Set to `false` for production builds. Defaults to `true`.
     * Gates dev-only transforms such as `__source` injection.
     */
    isDev?: boolean;
    /** Optional logger. Defaults to console. */
    logger?: {
        debug: (msg: string) => void;
        info: (msg: string) => void;
        error: (msg: string, err?: unknown) => void;
    };
}

/**
 * Per-bundle options for `BrowserMetro.bundle()`.
 *
 * - `projectDependencies`: if provided, the bundler runs `checkReactVersions`
 *   (MC6.4) before transpiling and throws a `BundleError` on mismatch. Pass
 *   the combined `dependencies` + `devDependencies` map from the project's
 *   `package.json`. Omitting it skips the check — back-compat path for callers
 *   that don't have access to the project manifest.
 */
export interface BundleOptions {
    projectDependencies?: Record<string, string>;
}

export interface BundleModule {
    /** Source file path (e.g. 'App.tsx'). */
    path: string;
    /** Transpiled JavaScript ready for the iframe to eval. */
    code: string;
    /** Bare imports this module references — left for the iframe import map. */
    deps: string[];
}

export interface BundleResult {
    /** Map from file path to transpiled module. */
    modules: Record<string, BundleModule>;
    /** Inferred entry path. Defaults to App.tsx, App.jsx, App.js, or src/App.tsx. */
    entry: string;
    /** Total transpile time in milliseconds. */
    durationMs: number;
    /** Self-contained IIFE that the iframe can <script>-tag (TR2.4). */
    iife: string;
    /** Importmap JSON for the iframe HTML shell. */
    importmap: string;
    /** All unique bare imports from across the bundle (used by SW). */
    bareImports: string[];
}

export class BundleError extends Error {
    constructor(
        message: string,
        public readonly file?: string,
        public readonly cause?: unknown,
    ) {
        super(message);
        this.name = 'BundleError';
    }
}
