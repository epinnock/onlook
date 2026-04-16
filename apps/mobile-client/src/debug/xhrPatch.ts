/**
 * XMLHttpRequest patch — intercepts `globalThis.XMLHttpRequest.prototype`
 * to capture network request entries for the debug inspector panel.
 *
 * Shares the {@link NetworkEntry} type with {@link FetchPatch} (MC5.3) so
 * consumers can merge feeds externally, but maintains its OWN ring buffer
 * and listener set. This keeps the two patches loosely coupled — callers
 * that want a unified view can listen to both and merge, while callers
 * that only care about XHR (or only fetch) can use each independently.
 *
 * The patched prototype is fully transparent: callers see the same
 * request lifecycle they would without the patch.
 *
 * Task: MC5.4
 * Deps: MCF1, MC5.3
 */

import type { NetworkEntry } from './fetchPatch';

/** Maximum number of entries retained by the ring buffer. */
const MAX_BUFFER_SIZE = 100;

/** Listener callback type. */
type EntryListener = (entry: NetworkEntry) => void;

/** Incrementing counter used for generating unique entry IDs. */
let nextId = 1;

/** Generate a unique string ID for a network entry. */
function generateId(): string {
    if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }
    return `xhr-${nextId++}`;
}

/**
 * Parse an XHR `getAllResponseHeaders()` blob into a plain Record.
 *
 * The blob is a CRLF-delimited list of `Header-Name: value` pairs per
 * XHR spec. This helper normalises header names to lowercase for
 * consistency with {@link fetchPatch}'s `Headers.forEach` output.
 */
function parseResponseHeaders(raw: string | null): Record<string, string> {
    const result: Record<string, string> = {};
    if (!raw) return result;

    const lines = raw.split(/\r?\n/);
    for (const line of lines) {
        if (!line) continue;
        const idx = line.indexOf(':');
        if (idx === -1) continue;
        const name = line.slice(0, idx).trim().toLowerCase();
        const value = line.slice(idx + 1).trim();
        if (name) {
            result[name] = value;
        }
    }
    return result;
}

/**
 * Minimal structural shape of `XMLHttpRequest` that we rely on. Declared
 * locally so the module compiles in environments without DOM lib types
 * (e.g. bare Hermes). Only the members we actually read/write are here.
 */
interface XhrLike {
    readonly readyState: number;
    readonly status: number;
    open(method: string, url: string, async?: boolean, user?: string | null, password?: string | null): void;
    send(body?: unknown): void;
    setRequestHeader(name: string, value: string): void;
    getAllResponseHeaders(): string;
    onreadystatechange: ((this: XhrLike, ev: Event) => unknown) | null;
    onerror: ((this: XhrLike, ev: Event) => unknown) | null;
    onabort: ((this: XhrLike, ev: Event) => unknown) | null;
    ontimeout: ((this: XhrLike, ev: Event) => unknown) | null;
}

/** Internal per-instance state stashed on the XHR object. */
interface XhrState {
    id: string;
    method: string;
    url: string;
    startTime: string;
    startMs: number;
    requestHeaders: Record<string, string>;
    finalized: boolean;
}

/**
 * Symbol-keyed property name used to attach per-request state to XHR
 * instances without risking collisions with user code.
 */
const STATE_KEY = '__onlookXhrState__';

/** Access the internal state bag for an XHR instance. */
function getState(xhr: XhrLike): XhrState | undefined {
    return (xhr as unknown as Record<string, XhrState | undefined>)[STATE_KEY];
}

/** Set the internal state bag for an XHR instance. */
function setState(xhr: XhrLike, state: XhrState | undefined): void {
    (xhr as unknown as Record<string, XhrState | undefined>)[STATE_KEY] = state;
}

/**
 * Intercepts `globalThis.XMLHttpRequest.prototype` to capture network
 * entries into a ring buffer and emit them to registered listeners.
 *
 * Use the exported {@link xhrPatch} singleton for app-wide access.
 */
export class XhrPatch {
    /** Ring buffer storage. */
    private _buffer: (NetworkEntry | undefined)[];
    /** Next write position in the ring buffer. */
    private _head = 0;
    /** Current number of entries (capped at MAX_BUFFER_SIZE). */
    private _size = 0;

    /** Registered listeners. */
    private _listeners: Set<EntryListener> = new Set();

    /** Saved original prototype methods (populated on install). */
    private _originalOpen:
        | ((this: XhrLike, method: string, url: string, async?: boolean, user?: string | null, password?: string | null) => void)
        | null = null;
    private _originalSend: ((this: XhrLike, body?: unknown) => void) | null = null;
    private _originalSetRequestHeader:
        | ((this: XhrLike, name: string, value: string) => void)
        | null = null;

    /** Whether the patch is currently installed. */
    private _installed = false;

    constructor() {
        this._buffer = new Array<NetworkEntry | undefined>(MAX_BUFFER_SIZE);
    }

    /**
     * Replace prototype methods on `globalThis.XMLHttpRequest` with wrappers
     * that record request/response metadata.
     *
     * Safe to call multiple times — subsequent calls are no-ops. Safe to
     * call in environments without `XMLHttpRequest` (bare JS / Hermes) —
     * becomes a no-op in that case.
     */
    install(): void {
        if (this._installed) return;

        const Xhr = (globalThis as { XMLHttpRequest?: { prototype: XhrLike } }).XMLHttpRequest;
        if (!Xhr || !Xhr.prototype) return;

        this._installed = true;
        const self = this;
        const proto = Xhr.prototype;

        this._originalOpen = proto.open;
        this._originalSend = proto.send;
        this._originalSetRequestHeader = proto.setRequestHeader;

        const originalOpen = this._originalOpen;
        const originalSend = this._originalSend;
        const originalSetRequestHeader = this._originalSetRequestHeader;

        proto.open = function patchedOpen(
            this: XhrLike,
            method: string,
            url: string,
            async?: boolean,
            user?: string | null,
            password?: string | null,
        ): void {
            setState(this, {
                id: generateId(),
                method: method ?? 'GET',
                url: url ?? '',
                startTime: '',
                startMs: 0,
                requestHeaders: {},
                finalized: false,
            });
            // Forward — note we can't drop trailing args without breaking
            // overloads, so pass through exactly what we received.
            if (arguments.length <= 2) {
                originalOpen.call(this, method, url);
            } else if (arguments.length === 3) {
                originalOpen.call(this, method, url, async);
            } else if (arguments.length === 4) {
                originalOpen.call(this, method, url, async, user);
            } else {
                originalOpen.call(this, method, url, async, user, password);
            }
        };

        proto.setRequestHeader = function patchedSetRequestHeader(
            this: XhrLike,
            name: string,
            value: string,
        ): void {
            const state = getState(this);
            if (state && typeof name === 'string') {
                state.requestHeaders[name.toLowerCase()] = String(value);
            }
            originalSetRequestHeader.call(this, name, value);
        };

        proto.send = function patchedSend(this: XhrLike, body?: unknown): void {
            const state = getState(this);
            if (state) {
                state.startTime = new Date().toISOString();
                state.startMs = performance.now();

                // Hook readystatechange to capture the terminal response.
                // We preserve any user-supplied handler by invoking it first.
                const userOnReadyStateChange = this.onreadystatechange;
                this.onreadystatechange = function wrappedOnReadyStateChange(
                    this: XhrLike,
                    ev: Event,
                ): unknown {
                    // Call the user handler first so we do not change its
                    // view of readyState / status.
                    let result: unknown;
                    if (userOnReadyStateChange) {
                        try {
                            result = userOnReadyStateChange.call(this, ev);
                        } catch (err) {
                            // Record and rethrow after — but first surface
                            // the response so we do not lose the entry.
                            self._maybeFinalize(this, null);
                            throw err;
                        }
                    }
                    // readyState 4 = DONE
                    if (this.readyState === 4) {
                        self._maybeFinalize(this, null);
                    }
                    return result;
                };

                const userOnError = this.onerror;
                this.onerror = function wrappedOnError(this: XhrLike, ev: Event): unknown {
                    self._maybeFinalize(this, 'Network error');
                    if (userOnError) {
                        return userOnError.call(this, ev);
                    }
                    return undefined;
                };

                const userOnAbort = this.onabort;
                this.onabort = function wrappedOnAbort(this: XhrLike, ev: Event): unknown {
                    self._maybeFinalize(this, 'Request aborted');
                    if (userOnAbort) {
                        return userOnAbort.call(this, ev);
                    }
                    return undefined;
                };

                const userOnTimeout = this.ontimeout;
                this.ontimeout = function wrappedOnTimeout(this: XhrLike, ev: Event): unknown {
                    self._maybeFinalize(this, 'Request timed out');
                    if (userOnTimeout) {
                        return userOnTimeout.call(this, ev);
                    }
                    return undefined;
                };
            }
            originalSend.call(this, body);
        };
    }

    /**
     * Restore the original prototype methods. Safe to call when not installed.
     */
    uninstall(): void {
        if (!this._installed) return;
        this._installed = false;

        const Xhr = (globalThis as { XMLHttpRequest?: { prototype: XhrLike } }).XMLHttpRequest;
        if (Xhr && Xhr.prototype) {
            if (this._originalOpen) {
                Xhr.prototype.open = this._originalOpen;
            }
            if (this._originalSend) {
                Xhr.prototype.send = this._originalSend;
            }
            if (this._originalSetRequestHeader) {
                Xhr.prototype.setRequestHeader = this._originalSetRequestHeader;
            }
        }
        this._originalOpen = null;
        this._originalSend = null;
        this._originalSetRequestHeader = null;
    }

    /**
     * Register a listener that is called for every completed network entry.
     *
     * @returns An unsubscribe function. Calling it removes the listener.
     */
    onEntry(handler: EntryListener): () => void {
        this._listeners.add(handler);
        return () => {
            this._listeners.delete(handler);
        };
    }

    /**
     * Return a copy of the buffered entries in chronological order
     * (oldest first). The buffer is a ring buffer capped at 100 entries.
     */
    getBuffer(): NetworkEntry[] {
        const result: NetworkEntry[] = [];

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
        this._buffer = new Array<NetworkEntry | undefined>(MAX_BUFFER_SIZE);
        this._head = 0;
        this._size = 0;
    }

    /**
     * Build and push a NetworkEntry for the given XHR instance if one has
     * not yet been recorded. Idempotent — an XHR may fire multiple terminal
     * events (e.g. readystatechange DONE after error), but we only record
     * the first.
     */
    private _maybeFinalize(xhr: XhrLike, error: string | null): void {
        const state = getState(xhr);
        if (!state || state.finalized) return;
        state.finalized = true;

        const endMs = performance.now();
        const endTime = new Date().toISOString();
        const duration = Math.round(endMs - state.startMs);

        let responseHeaders: Record<string, string> | undefined;
        try {
            responseHeaders = parseResponseHeaders(xhr.getAllResponseHeaders());
        } catch {
            // Some environments throw before headers are received — ignore.
        }

        // If the error is a plain network error and the XHR managed to
        // record a status, prefer the status path; otherwise record error.
        const status = xhr.status && xhr.status !== 0 ? xhr.status : null;
        const entry: NetworkEntry = {
            id: state.id,
            method: state.method,
            url: state.url,
            status: error && !status ? null : status,
            startTime: state.startTime,
            endTime,
            duration,
            requestHeaders:
                Object.keys(state.requestHeaders).length > 0 ? state.requestHeaders : undefined,
            responseHeaders:
                responseHeaders && Object.keys(responseHeaders).length > 0
                    ? responseHeaders
                    : undefined,
            error: error ?? undefined,
        };

        this._pushEntry(entry);
    }

    /** Push an entry to the ring buffer and notify listeners. */
    private _pushEntry(entry: NetworkEntry): void {
        this._buffer[this._head] = entry;
        this._head = (this._head + 1) % MAX_BUFFER_SIZE;
        if (this._size < MAX_BUFFER_SIZE) {
            this._size++;
        }

        for (const listener of this._listeners) {
            try {
                listener(entry);
            } catch {
                // Listener errors must never re-enter the patch.
            }
        }
    }
}

/** App-wide singleton. Import this rather than instantiating your own. */
export const xhrPatch = new XhrPatch();
