export {
    ESBUILD_WASM_PATH_GLOBAL_KEY,
    getEsbuildWasmPath,
    resolveEsbuildWasmPath,
    setEsbuildWasmPath,
    type EsbuildWasmPathLike,
    type EsbuildWasmPathScope,
    type ResolveEsbuildWasmPathOptions,
    type SetEsbuildWasmPathOptions,
} from './esbuild-path';

export {
    createIncrementalBundler,
    fingerprintInput,
    type IncrementalBuildHit,
    type IncrementalBundler,
} from './incremental';

export {
    bundleBrowserProject,
    type BrowserBundlerEsbuildService,
    type BrowserBundlerBuildOptions,
    type BrowserBundlerBuildResult,
    type BrowserBundlerOutputFile,
    type BrowserBundlerPlugin,
    type BundleBrowserProjectResult,
} from './bundle';

export {
    wrapOverlayCode,
    DEFAULT_OVERLAY_MOUNT_GLOBAL,
    type WrapOverlayOptions,
    type WrappedOverlay,
} from './wrap-overlay';

// ADR-0001 / two-tier-overlay-v2 task #30 — Hermes-safe ABI-v1 overlay wrapper.
export {
    wrapOverlayV1,
    isHermesSafeOverlay,
    OverlayWrapError,
    OVERLAY_SIZE_HARD_CAP,
    OVERLAY_SIZE_SOFT_CAP,
    OVERLAY_BUILD_SLOW_MS,
    OVERLAY_EVAL_TARGET_MS,
    type WrapOverlayV1Options,
    type WrappedOverlayV1,
} from './wrap-overlay-v1';

// Tasks #98–#100 — pure size-gate checker for CI / editor pre-upload guards.
export {
    checkOverlaySize,
    type CheckOverlaySizeOptions,
    type OverlaySizeCheckResult,
    type OverlaySizeStatus,
} from './check-overlay-size';

// Task #47 — pure-JS package artifact format.
export {
    createInMemoryPureJsCache,
    mergePureJsArtifactIntoOverlay,
    resolvePureJsModule,
    type OverlayModuleRegistry,
    type PureJsArtifactCache,
    type PureJsPackageArtifact,
} from './pure-js-package';

// Tasks #47 + #48 — editor-side remote + layered artifact cache.
export {
    createLayeredPureJsCache,
    createRemotePureJsCache,
    type LayeredCacheFast,
    type LayeredCacheSlow,
    type RemotePureJsCache,
    type RemotePureJsCacheOptions,
} from './remote-pure-js-cache';

export {
    preflightUnsupportedImports,
    assertNoUnsupportedImports,
    findUnsupportedImports,
    preflightAbiV1Imports,
    assertAbiV1Imports,
    type UnsupportedImportPreflightIssue,
    type UnsupportedImportPreflightOptions,
    type AbiV1PreflightIssue,
    type AbiV1PreflightIssueKind,
    type AbiV1PreflightOptions,
} from './preflight';
