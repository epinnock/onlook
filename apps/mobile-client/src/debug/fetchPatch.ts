/**
 * Fetch patch — intercepts `globalThis.fetch` to capture network request
 * entries for the debug inspector panel.
 *
 * The patched fetch is fully transparent: callers receive the original
 * Response (or rejection) unchanged.
 *
 * Task: MC5.3
 * Deps: MCF1
 */

/** Maximum number of entries retained by the ring buffer. */
const MAX_BUFFER_SIZE = 100;

/** A single captured network request entry. */
export interface NetworkEntry {
    id: string;
    method: string;
    url: string;
    status: number | null;
    startTime: string;
    endTime: string | null;
    duration: number | null;
    requestHeaders?: Record<string, string>;
    responseHeaders?: Record<string, string>;
    error?: string;
}

/** Listener callback type. */
type EntryListener = (entry: NetworkEntry) => void;

/** Incrementing counter used for generating unique entry IDs. */
let nextId = 1;

/** Generate a unique string ID for a network entry. */
function generateId(): string {
    if (typeof globalThis.crypto !== 'undefined' && typeof globalThis.crypto.randomUUID === 'function') {
        return globalThis.crypto.randomUUID();
    }
    return `fetch-${nextId++}`;
}

/**
 * Extract headers from a `Headers` object into a plain Record.
 */
function headersToRecord(headers: Headers): Record<string, string> {
    const result: Record<string, string> = {};
    headers.forEach((value, key) => {
        result[key] = value;
    });
    return result;
}

/**
 * Resolve the HTTP method and URL from fetch arguments.
 *
 * `fetch` accepts:
 * - `fetch(url: string | URL, init?: RequestInit)`
 * - `fetch(request: Request)`
 *
 * This helper normalises both forms.
 */
function resolveRequestInfo(
    input: RequestInfo | URL,
    init?: RequestInit,
): { method: string; url: string; requestHeaders?: Record<string, string> } {
    let method = 'GET';
    let url: string;
    let requestHeaders: Record<string, string> | undefined;

    if (typeof input === 'string') {
        url = input;
    } else if (typeof URL !== 'undefined' && input instanceof URL) {
        url = input.toString();
    } else {
        // input is a Request object
        const req = input as Request;
        url = req.url;
        method = req.method;
        if (req.headers) {
            requestHeaders = headersToRecord(new Headers(req.headers));
        }
    }

    // `init` overrides when present.
    if (init?.method) {
        method = init.method;
    }
    if (init?.headers) {
        requestHeaders = headersToRecord(new Headers(init.headers as HeadersInit));
    }

    return { method, url, requestHeaders };
}

/**
 * Intercepts `globalThis.fetch` to capture network entries into a ring buffer
 * and emit them to registered listeners.
 *
 * Use the exported {@link fetchPatch} singleton for app-wide access.
 */
export class FetchPatch {
    /** Ring buffer storage. */
    private _buffer: (NetworkEntry | undefined)[];
    /** Next write position in the ring buffer. */
    private _head = 0;
    /** Current number of entries (capped at MAX_BUFFER_SIZE). */
    private _size = 0;

    /** Registered listeners. */
    private _listeners: Set<EntryListener> = new Set();

    /** Saved original fetch (populated on install). */
    private _originalFetch: typeof globalThis.fetch | null = null;

    /** Whether the patch is currently installed. */
    private _installed = false;

    constructor() {
        this._buffer = new Array<NetworkEntry | undefined>(MAX_BUFFER_SIZE);
    }

    /**
     * Replace `globalThis.fetch` with a wrapper that records request/response
     * metadata.
     *
     * Safe to call multiple times — subsequent calls are no-ops.
     */
    install(): void {
        if (this._installed) return;
        this._installed = true;

        this._originalFetch = globalThis.fetch;
        const self = this;
        const original = this._originalFetch;

        globalThis.fetch = function patchedFetch(
            input: RequestInfo | URL,
            init?: RequestInit,
        ): Promise<Response> {
            const { method, url, requestHeaders } = resolveRequestInfo(input, init);
            const id = generateId();
            const startTime = new Date().toISOString();
            const startMs = performance.now();

            const entry: NetworkEntry = {
                id,
                method,
                url,
                status: null,
                startTime,
                endTime: null,
                duration: null,
                requestHeaders,
            };

            // Normalise URL objects to strings so the call is compatible with
            // environments where fetch only accepts RequestInfo (not URL).
            const fetchInput: RequestInfo =
                typeof URL !== 'undefined' && input instanceof URL
                    ? input.toString()
                    : (input as RequestInfo);

            return original.call(globalThis, fetchInput, init).then(
                (response: Response) => {
                    const endMs = performance.now();
                    entry.status = response.status;
                    entry.endTime = new Date().toISOString();
                    entry.duration = Math.round(endMs - startMs);
                    entry.responseHeaders = headersToRecord(response.headers);

                    self._pushEntry(entry);
                    return response;
                },
                (err: unknown) => {
                    const endMs = performance.now();
                    entry.endTime = new Date().toISOString();
                    entry.duration = Math.round(endMs - startMs);
                    entry.error = err instanceof Error ? err.message : String(err);

                    self._pushEntry(entry);
                    throw err;
                },
            );
        };
    }

    /**
     * Restore the original `globalThis.fetch`. Safe to call when not installed.
     */
    uninstall(): void {
        if (!this._installed) return;
        this._installed = false;

        if (this._originalFetch !== null) {
            globalThis.fetch = this._originalFetch;
            this._originalFetch = null;
        }
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

    /** Push an entry to the ring buffer and notify listeners. */
    private _pushEntry(entry: NetworkEntry): void {
        this._buffer[this._head] = entry;
        this._head = (this._head + 1) % MAX_BUFFER_SIZE;
        if (this._size < MAX_BUFFER_SIZE) {
            this._size++;
        }

        for (const listener of this._listeners) {
            listener(entry);
        }
    }
}

/** App-wide singleton. Import this rather than instantiating your own. */
export const fetchPatch = new FetchPatch();
