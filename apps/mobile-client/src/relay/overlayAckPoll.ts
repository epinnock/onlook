import type { TypedRelayEvent } from '@onlook/mobile-client-protocol';
import type {
    HttpGetFn,
    HttpGetResult,
    RelayEvent,
    RelayEventPollHandle,
} from '@onlook/mobile-preview';
import { parseRelayEvent } from '@onlook/mobile-client-protocol';
import { startRelayEventPoll } from '@onlook/mobile-preview';

/**
 * overlayAckPoll — mobile-client wrapper around the relay event poll.
 *
 * Bridgeless iOS 18.6 doesn't dispatch WebSocket `onopen`/`onmessage` events
 * back to JS (ADR `v2-pipeline-validation-findings.md` finding #8). This
 * module replaces the WS phone→editor channel with a synchronous-JSI HTTP
 * poll over `OnlookRuntime.httpGet` — the same workaround already used for
 * manifest + bundle fetches.
 *
 * The low-level polling primitive lives in `@onlook/mobile-preview` as
 * `startRelayEventPoll`. This wrapper:
 *   1. Resolves `OnlookRuntime.httpGet` at start time (the native binding
 *      may not exist in Spike-B / dev-harness contexts).
 *   2. Adapts the shape so callers don't need to reach into `globalThis`.
 *   3. Returns a `{ stop() }` handle that `twoTierBootstrap`'s teardown
 *      can call when the session ends or a new bundle mounts.
 *
 * Task: MCG.10 step 3.
 */

type OnlookRuntimeWithHttpGet = {
    httpGet?: (url: string, headers?: Record<string, string>) => HttpGetResult;
};

type GlobalWithRuntime = typeof globalThis & {
    OnlookRuntime?: OnlookRuntimeWithHttpGet;
};

/**
 * Resolves `globalThis.OnlookRuntime.httpGet` to a plain fetch function.
 * Returns `undefined` when the native binding isn't installed — callers
 * should skip overlay-ack polling in that case (the Spike-B dev harness
 * path does not have it).
 */
export function resolveHttpGet(): HttpGetFn | undefined {
    const gt = globalThis as GlobalWithRuntime;
    const fn = gt.OnlookRuntime?.httpGet;
    return typeof fn === 'function' ? fn.bind(gt.OnlookRuntime) : undefined;
}

export type OverlayAckPollOptions = {
    relayHost: string;
    sessionId: string;
    /**
     * Called with each event. Payload shape depends on `validate`:
     * - `validate: true` (default)  — event is a `TypedRelayEvent` (Zod-checked).
     * - `validate: false`           — event is the raw `RelayEvent` (`data: unknown`).
     *
     * Prefer the validated path in production — callers get a discriminated
     * union `data` field + safe handling of a malformed relay push. Drop to
     * raw only when a test intentionally feeds untyped shapes.
     */
    onEvent: (event: RelayEvent | TypedRelayEvent) => void;
    onError?: (error: Error) => void;
    pollIntervalMs?: number;
    /** Validate each event via `parseRelayEvent` before dispatch. Defaults to `true`. */
    validate?: boolean;
};

export type OverlayAckPollHandle = RelayEventPollHandle & {
    readonly installed: boolean;
};

/**
 * Start polling the relay's `/events` endpoint for overlay acks + any
 * other phone→editor event. If the native `OnlookRuntime.httpGet` binding
 * is unavailable, returns a `installed:false` no-op handle so callers
 * don't have to branch.
 */
export function startOverlayAckPoll(opts: OverlayAckPollOptions): OverlayAckPollHandle {
    const httpGet = resolveHttpGet();
    if (!httpGet) {
        // No-op handle — nothing was started, nothing to tear down.
        const noopStop = (): void => undefined;
        return {
            installed: false,
            stop: noopStop,
            getCursor: () => undefined,
            getSeenCount: () => 0,
        };
    }
    // Normalise the relayHost argument: callers sometimes pass a full
    // manifest URL (scheme + port + /manifest/...). The relay's /events
    // endpoint lives at the root, so strip everything after the authority
    // and re-append `/events`.
    const relayEventsUrl = buildEventsUrl(opts.relayHost);
    const validate = opts.validate ?? true;
    const dispatch = validate
        ? (raw: RelayEvent): void => {
              const res = parseRelayEvent(raw);
              if (res.ok) {
                  opts.onEvent(res.event);
                  return;
              }
              opts.onError?.(
                  new Error(
                      `overlayAckPoll: invalid event id=${raw.id ?? '?'} type=${raw.type ?? '?'}: ${res.error}`,
                  ),
              );
          }
        : (raw: RelayEvent): void => opts.onEvent(raw);

    const handle = startRelayEventPoll({
        relayHost: relayEventsUrl,
        sessionId: opts.sessionId,
        httpGet,
        onEvent: dispatch,
        onError: opts.onError,
        pollIntervalMs: opts.pollIntervalMs,
    });
    return { installed: true, ...handle };
}

export function buildEventsUrl(relayHost: string): string {
    try {
        const u = new URL(relayHost);
        return `${u.protocol}//${u.host}/events`;
    } catch {
        // Not a full URL (bare hostname, or already a path). Append /events
        // if the caller hasn't done so already.
        const trimmed = relayHost.replace(/\/+$/, '');
        return trimmed.endsWith('/events') ? trimmed : `${trimmed}/events`;
    }
}
