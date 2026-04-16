/**
 * JS-side receiver for taps captured by
 * `apps/mobile-client/ios/OnlookMobileClient/FabricEventBootstrap.mm`.
 *
 * The native side installs a `UITapGestureRecognizer` on the Fabric
 * root view (pragmatic substitute for the unavailable bridgeless
 * Fabric `registerEventHandler` API surface — see the `.mm` file's
 * header comment for rationale) and forwards each tap through
 * `OnlookTapForwarder`'s `RCTEventEmitter` singleton under the
 * `onlookTap` event name.
 *
 * This module subscribes to that event and republishes it on the
 * `OnlookRuntime` event bus as `onlook:tap` with `{x, y}`. Hit-testing
 * and `reactTag` resolution happen in JS (MC4.2's `findNodeAtPoint`),
 * so this bridge only carries raw coordinates.
 *
 * Task: MC2.5 (JS-side counterpart).
 * Deps:
 *   - MC4.6 — `OnlookTapForwarder` RCTEventEmitter (native side ships
 *     the `onlookTap` event channel)
 *   - MC2.2 / MC2.3 — `OnlookRuntime` host object with
 *     `dispatchEvent(event, payload)` on `globalThis`.
 */

import { NativeEventEmitter, NativeModules } from 'react-native';
import type { EmitterSubscription, NativeModule } from 'react-native';

/** Shape posted by the native tap forwarder. */
export interface NativeTapEvent {
    x: number;
    y: number;
    reactTag?: number;
    source?: {
        fileName: string;
        lineNumber: number;
        columnNumber: number;
    } | null;
}

/** Shape we forward on the `OnlookRuntime` event bus. */
export interface OnlookTapPayload {
    x: number;
    y: number;
}

/**
 * Minimal shape of the `OnlookRuntime` host object we depend on. Kept
 * as a structural type so this file doesn't need to import the full
 * runtime typing (which is maintained under `cpp/` headers and not
 * bridged to TS).
 */
interface OnlookRuntimeLike {
    dispatchEvent: (event: string, payload: unknown) => void;
}

/** Name under which the native side emits. Must match `OnlookTapForwarder.mm`. */
const NATIVE_EVENT_NAME = 'onlookTap';
/** Name we dispatch on `OnlookRuntime`. Must match the runtime shell contract. */
const RUNTIME_EVENT_NAME = 'onlook:tap';

/**
 * Resolve `OnlookRuntime` off `globalThis` lazily at dispatch time.
 * The native installer (`OnlookRuntimeInstaller`) sets the global
 * before the JS bundle evaluates, but we avoid caching the reference
 * here so a bundle reload (which reinstalls the global) picks up the
 * fresh runtime automatically.
 */
function getOnlookRuntime(): OnlookRuntimeLike | null {
    const g = globalThis as unknown as { OnlookRuntime?: unknown };
    const rt = g.OnlookRuntime;
    if (rt === null || typeof rt !== 'object') return null;
    const candidate = rt as { dispatchEvent?: unknown };
    if (typeof candidate.dispatchEvent !== 'function') return null;
    return candidate as OnlookRuntimeLike;
}

/**
 * Minimal accessor for a native module that exposes an
 * `addListener` / `removeListeners` API surface (i.e. an
 * `RCTEventEmitter`). Returns `null` when the module isn't registered
 * — expected on Android / in tests where `OnlookTapForwarder` doesn't
 * exist yet.
 */
function getTapForwarderModule(): Record<string, unknown> | null {
    const mod = NativeModules.OnlookTapForwarder as unknown;
    if (mod === null || typeof mod !== 'object') return null;
    return mod as Record<string, unknown>;
}

/**
 * Subscribe to native taps and forward them as `onlook:tap` events on
 * `OnlookRuntime`. Returns a tear-down function that removes the
 * native listener; callers should invoke it when the handler is no
 * longer needed (e.g. on a hot reload or app shutdown path).
 *
 * Safe to call on any platform — on Android (or in tests without the
 * native module) the function is a no-op and returns a tear-down that
 * is also a no-op.
 *
 * Idempotent: repeated calls add independent listeners, but each
 * returned tear-down only removes the listener it created. Call sites
 * typically invoke this once at app boot.
 */
export function startTapBridge(options?: {
    warn?: (message: string, detail?: unknown) => void;
}): () => void {
    const warn =
        options?.warn ??
        ((msg: string, detail?: unknown) => {
            if (detail === undefined) console.warn(msg);
            else console.warn(msg, detail);
        });

    const nativeModule = getTapForwarderModule();
    if (nativeModule === null) {
        // Expected on Android / in tests — the iOS-only forwarder
        // isn't present. Bail silently with a no-op disposer.
        return () => {};
    }

    // `NativeEventEmitter` on iOS requires the module reference so RN
    // can call its `startObserving` / `stopObserving` lifecycle hooks
    // (see `OnlookTapForwarder.mm`). Cast through `unknown` so we
    // don't fight RN's loose typing for `NativeModule`.
    const emitter = new NativeEventEmitter(nativeModule as unknown as NativeModule);

    let subscription: EmitterSubscription | null = null;
    try {
        subscription = emitter.addListener(NATIVE_EVENT_NAME, (event: NativeTapEvent) => {
            if (event === null || typeof event !== 'object') return;
            const x = typeof event.x === 'number' ? event.x : NaN;
            const y = typeof event.y === 'number' ? event.y : NaN;
            if (!Number.isFinite(x) || !Number.isFinite(y)) {
                warn('[tapBridge] Dropping native tap with non-finite coordinates', event);
                return;
            }

            const runtime = getOnlookRuntime();
            if (runtime === null) {
                warn('[tapBridge] OnlookRuntime not yet installed — dropping tap', { x, y });
                return;
            }

            try {
                const payload: OnlookTapPayload = { x, y };
                runtime.dispatchEvent(RUNTIME_EVENT_NAME, payload);
            } catch (err) {
                warn('[tapBridge] OnlookRuntime.dispatchEvent threw', err);
            }
        });
    } catch (err) {
        warn('[tapBridge] Failed to subscribe to native OnlookTapForwarder', err);
        return () => {};
    }

    return () => {
        if (subscription !== null) {
            subscription.remove();
            subscription = null;
        }
    };
}
