/**
 * Native JS exception catcher — captures unhandled JavaScript exceptions
 * thrown from inside `runApplication` (Hermes) and routes them to an error
 * surface (ErrorBoundary / crash overlay / debug relay).
 *
 * React Native installs a global error handler on `globalThis.ErrorUtils`
 * that Hermes calls when a JS exception escapes `runApplication` or a
 * timer / microtask. We wrap that handler so we can buffer the exception
 * and broadcast it to listeners while still forwarding to the original
 * handler (which renders the RN red-box in dev builds).
 *
 * When running outside RN (bare JS contexts, tests, browser fallback), we
 * also patch `window.onerror` if available so manual `captureException`
 * calls from {@link ErrorBoundary} still end up in the buffer.
 *
 * Task: MC5.7
 * Deps: MCF1
 */

/** Maximum number of entries retained by the ring buffer. */
const MAX_BUFFER_SIZE = 50;

/** Prefix applied to every console.error emitted by this module. */
const LOG_PREFIX = '[onlook-runtime]';

/** A single captured exception entry. */
export interface ExceptionEntry {
    /** Primary error message (typically `error.message`). */
    message: string;
    /** Full JS stack trace, or `null` if unavailable. */
    stack: string | null;
    /** React component stack (ErrorBoundary-supplied), or `null`. */
    componentStack: string | null;
    /** ISO timestamp of capture. */
    timestamp: string;
    /** Origin of the exception. */
    kind: 'js' | 'native';
}

/** Listener callback type. */
type EntryListener = (entry: ExceptionEntry) => void;

/**
 * Shape of React Native's `ErrorUtils` global.
 *
 * See `react-native/Libraries/polyfills/error-guard.js`. The handler is
 * invoked with `(error, isFatal)` whenever a JS exception escapes a task.
 */
interface ErrorUtilsLike {
    setGlobalHandler(handler: (error: Error, isFatal?: boolean) => void): void;
    getGlobalHandler?: () => ((error: Error, isFatal?: boolean) => void) | undefined;
}

/** Window-like shape for `window.onerror`. */
interface WindowLike {
    onerror:
        | ((
              message: string | Event,
              source?: string,
              lineno?: number,
              colno?: number,
              error?: Error,
          ) => boolean | void)
        | null;
}

/**
 * Look up `globalThis.ErrorUtils` in a way that is safe when the property
 * is absent (bare JS / browser / unit tests).
 */
function getErrorUtils(): ErrorUtilsLike | null {
    const eu = (globalThis as { ErrorUtils?: ErrorUtilsLike }).ErrorUtils;
    if (eu && typeof eu.setGlobalHandler === 'function') {
        return eu;
    }
    return null;
}

/**
 * Look up a DOM-style `window` in a way that is safe when absent.
 */
function getWindow(): WindowLike | null {
    const w = (globalThis as { window?: WindowLike }).window;
    if (w && 'onerror' in w) {
        return w;
    }
    return null;
}

/**
 * Intercepts unhandled JS exceptions and routes them to listeners + a
 * bounded ring buffer.
 *
 * Use the exported {@link exceptionCatcher} singleton for app-wide access.
 */
export class ExceptionCatcher {
    /** Ring buffer storage. */
    private _buffer: (ExceptionEntry | undefined)[];
    /** Next write position in the ring buffer. */
    private _head = 0;
    /** Current number of entries (capped at MAX_BUFFER_SIZE). */
    private _size = 0;

    /** Registered listeners. */
    private _listeners: Set<EntryListener> = new Set();

    /** Saved original RN global handler (populated on install). */
    private _originalRnHandler: ((error: Error, isFatal?: boolean) => void) | null = null;
    /** Saved original `window.onerror` (populated on install). */
    private _originalWindowOnError: WindowLike['onerror'] | null = null;
    /** Whether a window.onerror slot existed and was patched. */
    private _windowPatched = false;
    /** Whether an ErrorUtils handler was patched. */
    private _rnPatched = false;

    /** Whether the catcher is currently installed. */
    private _installed = false;

    constructor() {
        this._buffer = new Array<ExceptionEntry | undefined>(MAX_BUFFER_SIZE);
    }

    /**
     * Patch `globalThis.ErrorUtils.setGlobalHandler` (if present) and
     * `window.onerror` (if present) so unhandled JS exceptions are captured.
     *
     * Safe to call multiple times — subsequent calls are no-ops.
     */
    install(): void {
        if (this._installed) return;
        this._installed = true;

        // React Native path — Hermes routes `runApplication` exceptions here.
        const errorUtils = getErrorUtils();
        if (errorUtils) {
            this._rnPatched = true;
            const prior = errorUtils.getGlobalHandler?.();
            this._originalRnHandler = prior ?? null;

            errorUtils.setGlobalHandler((error: Error, isFatal?: boolean) => {
                this._capture(error, null, 'js');

                // Preserve RN's default red-box / fatal handling.
                if (this._originalRnHandler) {
                    try {
                        this._originalRnHandler(error, isFatal);
                    } catch {
                        // Swallow — we already captured the original exception.
                    }
                }
            });
        }

        // Browser / fallback path — not strictly required under RN but makes
        // the catcher useful in unit tests and web previews.
        const win = getWindow();
        if (win) {
            this._windowPatched = true;
            this._originalWindowOnError = win.onerror;

            win.onerror = (
                message: string | Event,
                source?: string,
                lineno?: number,
                colno?: number,
                error?: Error,
            ): boolean | void => {
                const err =
                    error ??
                    new Error(typeof message === 'string' ? message : 'Unknown error');
                this._capture(err, null, 'js');

                if (this._originalWindowOnError) {
                    try {
                        return this._originalWindowOnError(
                            message,
                            source,
                            lineno,
                            colno,
                            error,
                        );
                    } catch {
                        // Swallow — handler errors must not re-enter.
                    }
                }
                return undefined;
            };
        }
    }

    /**
     * Restore the original global handlers. Safe to call when not installed.
     */
    uninstall(): void {
        if (!this._installed) return;
        this._installed = false;

        if (this._rnPatched) {
            const errorUtils = getErrorUtils();
            if (errorUtils) {
                // Restore the prior handler, or a no-op if there wasn't one.
                errorUtils.setGlobalHandler(
                    this._originalRnHandler ?? ((_e: Error, _f?: boolean) => undefined),
                );
            }
            this._originalRnHandler = null;
            this._rnPatched = false;
        }

        if (this._windowPatched) {
            const win = getWindow();
            if (win) {
                win.onerror = this._originalWindowOnError;
            }
            this._originalWindowOnError = null;
            this._windowPatched = false;
        }
    }

    /**
     * Register a listener that is called for every captured exception.
     *
     * @returns An unsubscribe function. Calling it removes the listener.
     */
    onException(handler: EntryListener): () => void {
        this._listeners.add(handler);
        return () => {
            this._listeners.delete(handler);
        };
    }

    /**
     * Manually capture an exception. Used by the React ErrorBoundary
     * (MC5.6) which has access to `componentStack` on top of the error.
     */
    captureException(error: Error, componentStack?: string): void {
        this._capture(error, componentStack ?? null, 'js');
    }

    /**
     * Return a copy of the buffered entries in chronological order
     * (oldest first). The buffer is a ring buffer capped at 50 entries.
     */
    getBuffer(): ExceptionEntry[] {
        const result: ExceptionEntry[] = [];

        if (this._size < MAX_BUFFER_SIZE) {
            for (let i = 0; i < this._size; i++) {
                result.push(this._buffer[i]!);
            }
        } else {
            for (let i = 0; i < MAX_BUFFER_SIZE; i++) {
                result.push(this._buffer[(this._head + i) % MAX_BUFFER_SIZE]!);
            }
        }

        return result;
    }

    /** Clear all buffered entries. */
    clearBuffer(): void {
        this._buffer = new Array<ExceptionEntry | undefined>(MAX_BUFFER_SIZE);
        this._head = 0;
        this._size = 0;
    }

    /**
     * Core capture path used by both automatic and manual entrypoints.
     * Logs the exception, pushes an entry to the ring buffer, and fans
     * out to listeners.
     */
    private _capture(
        error: Error,
        componentStack: string | null,
        kind: 'js' | 'native',
    ): void {
        const entry: ExceptionEntry = {
            message: error.message || String(error),
            stack: error.stack ?? null,
            componentStack,
            timestamp: new Date().toISOString(),
            kind,
        };

        // Log with a consistent prefix so native-side log filters can
        // surface these separately from regular console output.
        try {
            // eslint-disable-next-line no-console
            console.error(`${LOG_PREFIX} uncaught exception:`, entry.message, entry.stack);
        } catch {
            // Console unavailable — ignore.
        }

        this._buffer[this._head] = entry;
        this._head = (this._head + 1) % MAX_BUFFER_SIZE;
        if (this._size < MAX_BUFFER_SIZE) {
            this._size++;
        }

        for (const listener of this._listeners) {
            try {
                listener(entry);
            } catch {
                // Listener errors must never re-enter the catcher.
            }
        }
    }
}

/** App-wide singleton. Import this rather than instantiating your own. */
export const exceptionCatcher = new ExceptionCatcher();
