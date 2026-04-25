import type {
    BrowserBundlerEsbuildService,
    IncrementalBundler,
} from '../../../../../../../packages/browser-bundler/src';
import type {
    MobilePreviewLaunchTarget,
    MobilePreviewPipeline,
    MobilePreviewPipelineCapabilities,
    MobilePreviewPipelineStatusCallback,
    MobilePreviewPipelineVfs,
    MobilePreviewPrepareInput,
    MobilePreviewSyncInput,
    MobilePreviewSyncResult,
    MobilePreviewTwoTierPipelineConfig,
    MobilePreviewTwoTierSyncResult,
} from './types';
import {
    emitOverlayPerfGuardrail,
    emitOverlayPushTelemetry,
} from '@/services/expo-relay/overlay-telemetry-sink';
import {
    evaluateBuildDuration,
    evaluatePushTelemetry,
    evaluateSizeDelta,
} from '@/services/expo-relay/perf-guardrails';
import {
    pushOverlay,
    pushOverlayV1,
    type PushOverlayCompatibilityResult,
} from '@/services/expo-relay/push-overlay';
import { uploadAssetBytes } from '@/services/expo-relay/asset-uploader';
import {
    checkOverlaySize,
    createIncrementalBundler,
    wrapOverlayCode,
    wrapOverlayV1,
} from '../../../../../../../packages/browser-bundler/src';
import { isMobilePreviewOverlayV1PipelineEnabled } from '../pipeline-flag';

const SOURCE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.json'] as const;
const BUNDLED_CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.json']);

/**
 * Bare specifiers that the base bundle provides. Matches the curated
 * registry the browser-bundler's `external` plugin ships with — keep in
 * sync with packages/browser-bundler/src/plugins/external.ts.
 */
const DEFAULT_BASE_EXTERNALS: readonly string[] = [
    'react',
    'react/jsx-runtime',
    'react-native',
    'react-native-safe-area-context',
    'expo',
    'expo-status-bar',
    'expo-router',
    'expo-modules-core',
];

/**
 * Editor injection point for the underlying esbuild service. Production
 * runtime supplies an esbuild-wasm-backed worker client; unit tests inject
 * a fake. If neither has registered one by the time sync() runs, the
 * pipeline throws a clear error rather than hitting a lazy import.
 */
let esbuildServiceFactory: (() => Promise<BrowserBundlerEsbuildService>) | null = null;

export function registerTwoTierEsbuildServiceFactory(
    factory: () => Promise<BrowserBundlerEsbuildService>,
): void {
    esbuildServiceFactory = factory;
}

export function clearTwoTierEsbuildServiceFactory(): void {
    esbuildServiceFactory = null;
}

export const twoTierMobilePreviewCapabilities: MobilePreviewPipelineCapabilities = {
    liveUpdates: true,
    onlookDeepLink: true,
};

export interface TwoTierMobilePreviewPipelineDependencies {
    /**
     * Overrides the global esbuild-service factory. Used by tests to inject
     * a deterministic fake without touching the module-level register.
     */
    readonly esbuildService?: BrowserBundlerEsbuildService;
    /** Session id override. Defaults to a random UUID minted in prepare(). */
    readonly sessionId?: string;
    /** Random id factory override for deterministic tests. */
    readonly createSessionId?: () => string;
    /** Incremental bundler override (defaults to a freshly-constructed one). */
    readonly incrementalBundler?: IncrementalBundler;
    /**
     * Phase 11b compatibility gate provider — typically
     * `() => relayWsClient.getLastAbiCompatibility()`. When supplied, every
     * v1 push is gated on this returning `'ok'`; `'unknown'` or an
     * `OnlookRuntimeError` fails-closed before the network round-trip
     * (see ADR-0009 §"Pre-flip check"). Omit to preserve today's
     * behavior — legacy callers and tests that don't model the handshake
     * stay on the unchanged path. Only consulted on the `useV1` branch;
     * the legacy `pushOverlay` path doesn't have a v1 envelope to gate.
     */
    readonly compatibilityProvider?: () => PushOverlayCompatibilityResult;
    /**
     * Phase 9 R2 source-map upload — when supplied, the v1 push branch
     * uploads `result.sourceMap` (JSON) via {@link uploadAssetBytes} to
     * the relay's `/base-bundle/assets/<sha256>` endpoint and passes the
     * resulting URI as `overlay.sourceMap` so the OverlayUpdateMessage
     * carries `meta.sourceMapUrl`. The fired callback informs the
     * hook-level resolver (see `lastOverlayMetaSourceMapUrlRef` in
     * `useMobilePreviewStatus`) so the source-map decoration receive-chain
     * (commits `0b09549f`..`be9586be`) starts mapping
     * `bundle.js:line:col` frames back to original source.
     *
     * Omit on legacy / shim contexts and on tests that don't model R2
     * — the v1 branch falls through to the no-sourceMap pushOverlayV1
     * path verbatim, preserving today's behavior.
     *
     * Wired by `useMobilePreviewStatus` against the same relay base URL
     * the relay-ws-client uses; the upload + push share the relay so
     * the URI is reachable to the phone via the same R2 binding.
     */
    readonly onSourceMapUploaded?: (sourceMapUrl: string) => void;
}

export class TwoTierMobilePreviewPipeline implements MobilePreviewPipeline<'two-tier'> {
    readonly kind = 'two-tier' as const;
    readonly capabilities = twoTierMobilePreviewCapabilities;

    private readonly config: MobilePreviewTwoTierPipelineConfig;
    private readonly injectedService: BrowserBundlerEsbuildService | null;
    private readonly createSessionId: () => string;
    private readonly incremental: IncrementalBundler;
    private readonly compatibilityProvider:
        | (() => PushOverlayCompatibilityResult)
        | null;
    private readonly onSourceMapUploaded:
        | ((sourceMapUrl: string) => void)
        | null;
    private sessionId: string | null;
    private resolvedService: BrowserBundlerEsbuildService | null;
    /**
     * Bytes of the previous successfully-pushed wrapped overlay; null until
     * the first push lands. Used by `evaluateSizeDelta` to surface
     * `size-grew`/`size-shrunk` perf-guardrail events when the user's overlay
     * jumps in size between consecutive saves (regression candidate vs. a
     * deliberate cleanup). Reset to null when the session id rotates so a
     * new session doesn't compare against a stale baseline.
     */
    private previousOverlayBytes: number | null = null;

    constructor(
        config: MobilePreviewTwoTierPipelineConfig,
        deps: TwoTierMobilePreviewPipelineDependencies = {},
    ) {
        this.config = config;
        this.injectedService = deps.esbuildService ?? null;
        this.createSessionId =
            deps.createSessionId ??
            (() =>
                typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
                    ? crypto.randomUUID()
                    : `sess-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`);
        this.incremental = deps.incrementalBundler ?? createIncrementalBundler();
        this.compatibilityProvider = deps.compatibilityProvider ?? null;
        this.onSourceMapUploaded = deps.onSourceMapUploaded ?? null;
        this.sessionId = deps.sessionId ?? null;
        this.resolvedService = this.injectedService;
    }

    async prepare(input: MobilePreviewPrepareInput): Promise<MobilePreviewLaunchTarget> {
        try {
            throwIfAborted(input.signal);
            // `requireConfig()` validates BOTH builderBaseUrl and relayBaseUrl
            // are present and throws on either missing; we only need the
            // relay URL from here on, so destructure just that. Keeping the
            // validation call preserves the builderBaseUrl-required contract.
            const { relayBaseUrl } = this.requireConfig();
            emitStatus(input.onStatus, { kind: 'preparing' });

            const sessionId = this.sessionId ?? this.createSessionId();
            this.sessionId = sessionId;

            const trimmedRelay = trimTrailingSlash(relayBaseUrl);
            // TODO(QC-1x): replace with a real base-bundle manifest hash once
            // the base-bundle-builder publishes to R2 and we can resolve it
            // here. Today the mobile client only needs the relay origin +
            // session id; the manifest URL is included for editor-side QR
            // flows that still display a full Expo-compatible URL.
            const manifestUrl = `${trimmedRelay}/manifest/${sessionId}`;

            const launchTarget: MobilePreviewLaunchTarget = {
                pipeline: 'two-tier',
                manifestUrl,
                qrUrl: buildOnlookDeepLink(sessionId, manifestUrl),
                onlookUrl: buildOnlookDeepLink(sessionId, manifestUrl),
                bundleHash: sessionId,
                clients: 0,
            };

            emitStatus(input.onStatus, { kind: 'ready', launchTarget });
            return launchTarget;
        } catch (cause) {
            if (isAbortError(cause)) {
                throw cause;
            }
            const message = formatError(cause);
            emitStatus(input.onStatus, { kind: 'error', message, cause });
            throw new Error(message);
        }
    }

    async sync(input: MobilePreviewSyncInput): Promise<MobilePreviewSyncResult> {
        try {
            throwIfAborted(input.signal);
            const { relayBaseUrl } = this.requireConfig();
            emitStatus(input.onStatus, { kind: 'building' });

            const service = await this.resolveService();
            const files = await collectVirtualFiles(input.fileSystem);
            const entryPoint = pickEntry(files);

            if (!entryPoint) {
                throw new Error(
                    'two-tier pipeline: no supported entry file found (expected one of App.tsx, index.ts, …)',
                );
            }

            const buildStartMs = Date.now();
            const { result, cached } = await this.incremental.build(
                {
                    entryPoint,
                    files,
                    externalSpecifiers: DEFAULT_BASE_EXTERNALS,
                    minify: false,
                    sourcemap: true,
                },
                service,
            );
            const buildDurationMs = Date.now() - buildStartMs;

            // Phase 11b soak: evaluate against the 1000ms build-slow
            // threshold (ADR-0001 §"Performance envelope"). Emits a
            // `build-slow` perf guardrail event when over budget. Uses
            // the soak sink so the dashboard sees builds by pipeline —
            // we don't yet know `useV1` at this exact line (the flag is
            // read next), so `evaluateBuildDuration` runs AFTER the
            // useV1 branch picks a pipeline tag below. This lets Q4-style
            // segmentation work for build-slow too.

            // Task #89-#94 / ADR-0009 Phase 11a — flag-gated parallel v1 path.
            // When `NEXT_PUBLIC_MOBILE_PREVIEW_PIPELINE=overlay-v1` is set, the
            // editor emits a Hermes-safe ABI v1 envelope via wrapOverlayV1 and
            // pushes via pushOverlayV1 (OverlayUpdateMessage shape). Defaults
            // to the legacy path so Phase G's shipped simulator mount flow
            // keeps working until the flag is flipped (ADR-0009 Phase 11b).
            const useV1 = isMobilePreviewOverlayV1PipelineEnabled();

            // Emit `build-slow` guardrail event via the soak sink so
            // the Phase 11b dashboard can compare build-time by
            // pipeline. Fires only when the build duration exceeds
            // `BUILD_SLOW_MS` (1000ms); returns null otherwise.
            evaluateBuildDuration(buildDurationMs, (perfEvent) =>
                emitOverlayPerfGuardrail(useV1 ? 'overlay-v1' : 'overlay-legacy', perfEvent),
            );

            // Tasks #98-#100 — Pre-push size gate on the v1 branch. The
            // relay already rejects > 2MB bodies with 413, but surfacing the
            // failure here gives a clearer error message that names the cap
            // and the overlay's actual size. Legacy branch skips this — its
            // wire shape has no hard cap gate yet and the relay's 413 is the
            // current enforcement point (tracked separately in Phase 11a).
            let wrapped: { code: string; sourceMap?: string };
            if (useV1) {
                const wrappedV1 = wrapOverlayV1(result.code, { sourceMap: result.sourceMap });
                const sizeCheck = checkOverlaySize(wrappedV1.code);
                if (sizeCheck.status === 'fail-hard') {
                    // Phase 11b soak: also emit a large-overlay guardrail
                    // event before throwing so the dashboard sees the
                    // hard-cap hit with pipeline=overlay-v1. Symmetric
                    // with the legacy branch below.
                    emitOverlayPerfGuardrail('overlay-v1', {
                        category: 'large-overlay',
                        severity: 'warn',
                        message: sizeCheck.message,
                        detail: {
                            bytes: sizeCheck.bytes,
                            softCap: sizeCheck.softCap,
                            hardCap: sizeCheck.hardCap,
                        },
                    });
                    throw new Error(`two-tier pipeline (v1): ${sizeCheck.message}`);
                }
                if (sizeCheck.status === 'warn-soft') {
                    // Mirrors cf-expo-relay's `hmr.push.v1.softcap` warn log.
                    // Surface soft-cap hits at the editor boundary too so
                    // bundle-bloat creep is observable before it reaches the
                    // relay.
                    console.warn(
                        '[two-tier.v1]',
                        JSON.stringify({
                            event: 'overlay.soft_cap',
                            bytes: sizeCheck.bytes,
                            softCap: sizeCheck.softCap,
                            hardCap: sizeCheck.hardCap,
                        }),
                    );
                    emitOverlayPerfGuardrail('overlay-v1', {
                        category: 'large-overlay',
                        severity: 'info',
                        message: sizeCheck.message,
                        detail: {
                            bytes: sizeCheck.bytes,
                            softCap: sizeCheck.softCap,
                            hardCap: sizeCheck.hardCap,
                        },
                    });
                }
                // sizeCheck.status === 'ok' → no action.
                if (wrappedV1.sizeWarning !== undefined) {
                    // wrapOverlayV1's own soft-cap warning (applies to INPUT
                    // source, not envelope). Log at same severity so both
                    // layers agree on observability.
                    console.warn('[two-tier.v1] wrap-overlay-v1:', wrappedV1.sizeWarning);
                }
                wrapped = wrappedV1;
            } else {
                wrapped = wrapOverlayCode(result.code, { sourceMap: result.sourceMap });
                // Phase 11b soak parity: observe the legacy wrapped size
                // through the same size gate the v1 branch uses. Does NOT
                // throw on fail-hard here — legacy is the baseline branch
                // we're trying to retire, so we preserve its behavior
                // (reach the relay, let the 413 decide) while still
                // emitting the `large-overlay` perf-guardrail event so
                // Phase 11b Q4 (soft-cap rate by pipeline) has symmetric
                // data for legacy vs v1. Soft-cap crossings emit an info
                // event (severity=info), hard-cap crossings emit a warn.
                const legacySizeCheck = checkOverlaySize(wrapped.code);
                if (legacySizeCheck.status === 'warn-soft') {
                    emitOverlayPerfGuardrail('overlay-legacy', {
                        category: 'large-overlay',
                        severity: 'info',
                        message: legacySizeCheck.message,
                        detail: {
                            bytes: legacySizeCheck.bytes,
                            softCap: legacySizeCheck.softCap,
                            hardCap: legacySizeCheck.hardCap,
                        },
                    });
                } else if (legacySizeCheck.status === 'fail-hard') {
                    emitOverlayPerfGuardrail('overlay-legacy', {
                        category: 'large-overlay',
                        severity: 'warn',
                        message: legacySizeCheck.message,
                        detail: {
                            bytes: legacySizeCheck.bytes,
                            softCap: legacySizeCheck.softCap,
                            hardCap: legacySizeCheck.hardCap,
                        },
                    });
                }
            }

            emitStatus(input.onStatus, { kind: 'pushing' });

            const sessionId = this.sessionId ?? this.createSessionId();
            this.sessionId = sessionId;

            // Phase 9 R2 source-map upload — when result.sourceMap exists
            // AND a relay base URL is configured, upload the map JSON to
            // /base-bundle/assets/<sha256> and pass the resulting URI as
            // overlay.sourceMap so the OverlayUpdateMessage carries
            // meta.sourceMapUrl. The hook-level resolver then returns this
            // URL for incoming onlook:error decoration. Best-effort: a
            // failed upload (network blip / 5xx / 413-over-cap) falls
            // through to a no-sourceMap push so the overlay still mounts;
            // the operator just doesn't get mapped frames for errors
            // produced by this overlay.
            let sourceMapUri: string | undefined;
            if (useV1 && result.sourceMap) {
                try {
                    const upload = await uploadAssetBytes({
                        relayBaseUrl,
                        sessionId,
                        bytes: new TextEncoder().encode(result.sourceMap),
                        mime: 'application/json',
                    });
                    if (upload.ok) {
                        sourceMapUri = upload.uri;
                        this.onSourceMapUploaded?.(upload.uri);
                    }
                } catch {
                    // Silent best-effort. Push proceeds without
                    // sourceMap — Phase 11b row #35 receive-chain
                    // fail-softs to undecorated frames.
                }
            }

            const pushResult = useV1
                ? await pushOverlayV1({
                      relayBaseUrl,
                      sessionId,
                      overlay: {
                          code: wrapped.code,
                          buildDurationMs,
                          ...(sourceMapUri !== undefined
                              ? { sourceMap: sourceMapUri }
                              : {}),
                      },
                      // Empty asset manifest is valid per pushOverlayV1. Full
                      // Phase 7 asset wiring lands in Phase 9 editor work —
                      // for Phase 11a the v1 branch just proves the wire shape
                      // round-trips end-to-end.
                      // Telemetry: every v1 push lands in the Phase 11b soak
                      // sink (posthog + console) AND every perf-guardrail
                      // threshold crossing (push-slow > 500ms, push-retried >
                      // 1, large-overlay > soft cap) lands there too.
                      // ADR-0009 §"Open questions" prerequisite. The relay's
                      // own soft-cap log is a server-side mirror of this.
                      onTelemetry: (event) => {
                          emitOverlayPushTelemetry('overlay-v1', event);
                          evaluatePushTelemetry(event, (perfEvent) =>
                              emitOverlayPerfGuardrail('overlay-v1', perfEvent),
                          );
                      },
                      // Phase 11b safety: when a compatibility provider is
                      // supplied (typically `() => relayWs.getLastAbiCompatibility()`)
                      // the push fail-closes pre-network on `'unknown'` /
                      // OnlookRuntimeError. Omitted -> today's behavior
                      // unchanged. Only the v1 branch gets the gate; the
                      // legacy `pushOverlay` below has no v1 envelope to
                      // gate.
                      ...(this.compatibilityProvider !== null
                          ? { compatibility: this.compatibilityProvider }
                          : {}),
                  })
                : await pushOverlay({
                      relayBaseUrl,
                      sessionId,
                      overlay: { code: wrapped.code, sourceMap: result.sourceMap },
                      // Phase 11b soak parity: legacy pushes get the same sink
                      // so the dashboard can diff v1-vs-legacy populations
                      // (push success rate, duration distribution, retry
                      // rate). Without this the legacy branch is invisible.
                      onTelemetry: (event) => {
                          emitOverlayPushTelemetry('overlay-legacy', event);
                          evaluatePushTelemetry(event, (perfEvent) =>
                              emitOverlayPerfGuardrail('overlay-legacy', perfEvent),
                          );
                      },
                  });

            if (!pushResult.ok) {
                throw new Error(`two-tier pipeline: push failed — ${pushResult.error}`);
            }

            // Phase 11b soak signal — surface bundle-size regressions across
            // consecutive successful pushes. Fires `size-grew` (warn) on a
            // ≥20% jump or `size-shrunk` (info) on a ≥10 KB drop. Skipped on
            // the first push of the session; reset whenever sessionId
            // rotates above. Both pipeline branches feed the same dashboard
            // segmentation as build-slow / push-slow / large-overlay.
            const previousBytes = this.previousOverlayBytes;
            const currentBytes = wrapped.code.length;
            evaluateSizeDelta(previousBytes, currentBytes, (perfEvent) =>
                emitOverlayPerfGuardrail(useV1 ? 'overlay-v1' : 'overlay-legacy', perfEvent),
            );
            this.previousOverlayBytes = currentBytes;

            const trimmedRelay = trimTrailingSlash(relayBaseUrl);
            const manifestUrl = `${trimmedRelay}/manifest/${sessionId}`;

            const launchTarget: MobilePreviewLaunchTarget = {
                pipeline: 'two-tier',
                manifestUrl,
                qrUrl: buildOnlookDeepLink(sessionId, manifestUrl),
                onlookUrl: buildOnlookDeepLink(sessionId, manifestUrl),
                bundleHash: sessionId,
                clients: pushResult.delivered,
            };

            emitStatus(input.onStatus, { kind: 'ready', launchTarget });

            const syncResult: MobilePreviewTwoTierSyncResult = {
                type: 'bundle-publish',
                pipeline: 'two-tier',
                launchTarget,
                bundleHash: sessionId,
                bundleSize: wrapped.code.length,
            };
            // Side-channel: when the incremental cache hit, the esbuild
            // service never fired. Surface that via status so the UI can
            // tell fast rebuilds apart.
            if (cached) {
                emitStatus(input.onStatus, {
                    kind: 'ready',
                    launchTarget: { ...launchTarget, bundleHash: `${sessionId}@cached` },
                });
            }
            return syncResult;
        } catch (cause) {
            if (isAbortError(cause)) {
                throw cause;
            }
            const message = formatError(cause);
            emitStatus(input.onStatus, { kind: 'error', message, cause });
            throw new Error(message);
        }
    }

    shouldSyncPath(filePath: string): boolean {
        const normalizedPath = normalizePath(filePath);
        if (!normalizedPath) {
            return false;
        }
        if (normalizedPath.includes('node_modules')) {
            return false;
        }
        if (normalizedPath.includes('.onlook/')) {
            return false;
        }
        if (
            normalizedPath === 'package-lock.json' ||
            normalizedPath === 'bun.lock' ||
            normalizedPath === 'bun.lockb'
        ) {
            return false;
        }
        return (
            SOURCE_EXTENSIONS.some((extension) => normalizedPath.endsWith(extension)) ||
            normalizedPath === 'package.json'
        );
    }

    dispose(): void {
        this.incremental.reset();
        this.previousOverlayBytes = null;
    }

    private requireConfig(): { builderBaseUrl: string; relayBaseUrl: string } {
        if (!this.config.relayBaseUrl) {
            throw new Error(
                'two-tier pipeline: missing relay base URL — set NEXT_PUBLIC_CF_EXPO_RELAY_URL',
            );
        }
        return {
            builderBaseUrl: this.config.builderBaseUrl,
            relayBaseUrl: this.config.relayBaseUrl,
        };
    }

    private async resolveService(): Promise<BrowserBundlerEsbuildService> {
        if (this.resolvedService) {
            return this.resolvedService;
        }
        if (esbuildServiceFactory) {
            const service = await esbuildServiceFactory();
            this.resolvedService = service;
            return service;
        }
        throw new Error(
            'two-tier pipeline: no esbuild service registered. Call registerTwoTierEsbuildServiceFactory() at editor boot.',
        );
    }
}

export function createTwoTierMobilePreviewPipeline(
    config: MobilePreviewTwoTierPipelineConfig,
    deps: TwoTierMobilePreviewPipelineDependencies = {},
): MobilePreviewPipeline<'two-tier'> {
    return new TwoTierMobilePreviewPipeline(config, deps);
}

// ──────────────────────────────────────────────────────────────────────────
// helpers
// ──────────────────────────────────────────────────────────────────────────

async function collectVirtualFiles(
    vfs: MobilePreviewPipelineVfs,
): Promise<Array<{ path: string; contents: string }>> {
    const entries = await vfs.listAll();
    const result: Array<{ path: string; contents: string }> = [];
    for (const entry of entries) {
        if (entry.type !== 'file') {
            continue;
        }
        const normalizedPath = normalizePath(entry.path);
        if (!isBundleableFile(normalizedPath)) {
            continue;
        }
        const raw = await vfs.readFile(normalizedPath);
        const contents = typeof raw === 'string' ? raw : new TextDecoder().decode(raw);
        result.push({ path: `/${normalizedPath}`, contents });
    }
    return result;
}

function isBundleableFile(normalizedPath: string): boolean {
    if (!normalizedPath || normalizedPath.includes('node_modules')) {
        return false;
    }
    const extension = lastExtension(normalizedPath);
    return BUNDLED_CODE_EXTENSIONS.has(extension);
}

function lastExtension(filePath: string): string {
    const idx = filePath.lastIndexOf('.');
    if (idx === -1) return '';
    return filePath.slice(idx).toLowerCase();
}

function pickEntry(files: ReadonlyArray<{ path: string; contents: string }>): string | null {
    // Prefer App.tsx (overlay entry), then index.tsx/ts, then anything that
    // looks entry-like.
    const candidates = ['/App.tsx', '/index.tsx', '/index.ts', '/src/App.tsx', '/src/index.tsx'];
    for (const candidate of candidates) {
        if (files.some((f) => f.path === candidate)) {
            return candidate;
        }
    }
    return null;
}

function buildOnlookDeepLink(sessionId: string, manifestUrl: string): string {
    const params = new URLSearchParams({
        session: sessionId,
        relay: manifestUrl,
    });
    return `onlook://launch?${params.toString()}`;
}

function trimTrailingSlash(input: string): string {
    return input.replace(/\/+$/, '');
}

function normalizePath(inputPath: string): string {
    return inputPath.replace(/\\/g, '/').replace(/^\/+/, '');
}

function emitStatus(
    cb: MobilePreviewPipelineStatusCallback | undefined,
    status: Parameters<MobilePreviewPipelineStatusCallback>[0],
): void {
    try {
        cb?.(status);
    } catch {
        // Status sinks must never affect control flow.
    }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
    if (signal?.aborted) {
        const reason: unknown = (signal as AbortSignal & { reason?: unknown }).reason;
        if (reason instanceof Error) {
            throw reason;
        }
        throw new DOMException('Aborted', 'AbortError');
    }
}

function isAbortError(error: unknown): boolean {
    return error instanceof DOMException && error.name === 'AbortError';
}

function formatError(cause: unknown): string {
    if (cause instanceof Error) {
        return cause.message;
    }
    return String(cause);
}
