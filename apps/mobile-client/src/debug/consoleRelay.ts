/**
 * Console relay — intercepts `console.log`, `console.warn`, `console.error`,
 * `console.info`, and `console.debug` to capture log entries for streaming
 * to the editor via the relay WebSocket.
 *
 * Each patched method still calls the original so dev-tools / Xcode console
 * output is preserved.
 *
 * Task: MC5.1
 * Deps: MCF1
 */

/** Maximum number of entries retained by the ring buffer. */
const MAX_BUFFER_SIZE = 200;

/** Log severity levels captured by the relay. */
export type ConsoleLevel = 'log' | 'warn' | 'error' | 'info' | 'debug';

/** A single captured console entry. */
export interface ConsoleEntry {
    level: ConsoleLevel;
    message: string;
    timestamp: string;
}

/** Listener callback type. */
type EntryListener = (entry: ConsoleEntry) => void;

/**
 * Safely serialize a single console argument to a string.
 *
 * - Primitives are converted via `String()`.
 * - Objects/arrays go through `JSON.stringify` wrapped in try/catch to
 *   handle circular references and other serialization failures.
 */
function serializeArg(arg: unknown): string {
    if (arg === null) return 'null';
    if (arg === undefined) return 'undefined';

    const type = typeof arg;
    if (type === 'string') return arg as string;
    if (type === 'number' || type === 'boolean' || type === 'bigint') {
        return String(arg);
    }
    if (type === 'symbol') return String(arg);
    if (type === 'function') return `[Function: ${(arg as { name?: string }).name || 'anonymous'}]`;

    // Object / array — attempt JSON.stringify, fall back on toString.
    if (arg instanceof Error) {
        return arg.stack ?? `${arg.name}: ${arg.message}`;
    }

    try {
        return JSON.stringify(arg);
    } catch {
        // Circular reference or other serialization failure.
        return String(arg);
    }
}

/**
 * Serialize all arguments passed to a console method into a single string,
 * space-separated (matching console's default formatting).
 */
function serializeArgs(args: unknown[]): string {
    return args.map(serializeArg).join(' ');
}

/**
 * Intercepts `console` methods to capture log entries into a ring buffer
 * and emit them to registered listeners.
 *
 * Use the exported {@link consoleRelay} singleton for app-wide access.
 */
export class ConsoleRelay {
    /** Ring buffer storage. */
    private _buffer: (ConsoleEntry | undefined)[];
    /** Next write position in the ring buffer. */
    private _head = 0;
    /** Current number of entries (capped at MAX_BUFFER_SIZE). */
    private _size = 0;

    /** Registered listeners. */
    private _listeners: Set<EntryListener> = new Set();

    /** Saved original console methods (populated on install). */
    private _originals: Record<ConsoleLevel, ((...args: unknown[]) => void) | null> = {
        log: null,
        warn: null,
        error: null,
        info: null,
        debug: null,
    };

    /** Whether the relay is currently installed. */
    private _installed = false;

    constructor() {
        this._buffer = new Array<ConsoleEntry | undefined>(MAX_BUFFER_SIZE);
    }

    /**
     * Patch `console.log`, `console.warn`, `console.error`, `console.info`,
     * and `console.debug` to capture arguments.
     *
     * Safe to call multiple times — subsequent calls are no-ops.
     */
    install(): void {
        if (this._installed) return;
        this._installed = true;

        const levels: ConsoleLevel[] = ['log', 'warn', 'error', 'info', 'debug'];

        for (const level of levels) {
            const original = console[level];
            this._originals[level] = original;

            console[level] = (...args: unknown[]): void => {
                // Always call the original method first.
                original.apply(console, args);

                const entry: ConsoleEntry = {
                    level,
                    message: serializeArgs(args),
                    timestamp: new Date().toISOString(),
                };

                // Push to ring buffer.
                this._buffer[this._head] = entry;
                this._head = (this._head + 1) % MAX_BUFFER_SIZE;
                if (this._size < MAX_BUFFER_SIZE) {
                    this._size++;
                }

                // Notify listeners.
                for (const listener of this._listeners) {
                    listener(entry);
                }
            };
        }
    }

    /**
     * Restore the original console methods. Safe to call when not installed.
     */
    uninstall(): void {
        if (!this._installed) return;
        this._installed = false;

        const levels: ConsoleLevel[] = ['log', 'warn', 'error', 'info', 'debug'];

        for (const level of levels) {
            const original = this._originals[level];
            if (original !== null) {
                console[level] = original;
                this._originals[level] = null;
            }
        }
    }

    /**
     * Register a listener that is called for every new console entry.
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
     * (oldest first). The buffer is a ring buffer capped at 200 entries.
     */
    getBuffer(): ConsoleEntry[] {
        const result: ConsoleEntry[] = [];

        if (this._size < MAX_BUFFER_SIZE) {
            // Buffer has not wrapped yet — entries are 0.._size-1.
            for (let i = 0; i < this._size; i++) {
                result.push(this._buffer[i]!);
            }
        } else {
            // Buffer has wrapped — _head points at the oldest entry.
            for (let i = 0; i < MAX_BUFFER_SIZE; i++) {
                result.push(this._buffer[(this._head + i) % MAX_BUFFER_SIZE]!);
            }
        }

        return result;
    }

    /** Clear all buffered entries. */
    clearBuffer(): void {
        this._buffer = new Array<ConsoleEntry | undefined>(MAX_BUFFER_SIZE);
        this._head = 0;
        this._size = 0;
    }
}

/** App-wide singleton. Import this rather than instantiating your own. */
export const consoleRelay = new ConsoleRelay();
