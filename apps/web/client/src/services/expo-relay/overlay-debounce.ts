/**
 * Overlay push debouncer — task #79 / two-tier-overlay-v2 Phase 9.
 *
 * Collapses rapid file-save events before calling pushOverlayV1. Trailing
 * debounce: the LAST scheduled push inside the window wins; earlier calls are
 * dropped silently. Cancel pending work on teardown to avoid races when the
 * user closes the preview mid-edit.
 *
 * Not an RxJS/lodash debounce because we want (1) no cross-package deps in
 * this layer, (2) test-injected clock for determinism, (3) awaitable cancel.
 */

export interface DebouncerOptions<T> {
    /** Trailing-debounce window in ms. Default 150ms. */
    readonly delayMs?: number;
    /** The action to invoke when the debounce window fires. */
    readonly invoke: (value: T) => Promise<void> | void;
    /** Optional clock injection for tests. Defaults to setTimeout/clearTimeout. */
    readonly clock?: {
        setTimeout(fn: () => void, ms: number): unknown;
        clearTimeout(handle: unknown): void;
    };
}

export interface Debouncer<T> {
    /** Schedule `value` to be invoked after the trailing window. */
    schedule(value: T): void;
    /** Cancel any pending invocation without firing it. */
    cancel(): void;
    /** True when an invocation is pending. */
    readonly pending: boolean;
    /** Await the next invocation (or cancellation) for test harnesses. */
    drain(): Promise<void>;
}

export function createOverlayDebouncer<T>(options: DebouncerOptions<T>): Debouncer<T> {
    const delayMs = options.delayMs ?? 150;
    const clock =
        options.clock ??
        ({
            setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
            clearTimeout: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
        } as const);

    let timer: unknown | null = null;
    let latestValue: T | null = null;
    let pendingDrain: Array<() => void> = [];
    let invocationInFlight = false;

    function resolveDrains(): void {
        const waiters = pendingDrain;
        pendingDrain = [];
        for (const fn of waiters) fn();
    }

    return {
        get pending(): boolean {
            return timer !== null;
        },
        schedule(value: T): void {
            latestValue = value;
            if (timer !== null) {
                clock.clearTimeout(timer);
                timer = null;
            }
            timer = clock.setTimeout(() => {
                timer = null;
                const toInvoke = latestValue as T;
                latestValue = null;
                invocationInFlight = true;
                try {
                    const result = options.invoke(toInvoke);
                    if (result && typeof (result as Promise<void>).then === 'function') {
                        (result as Promise<void>).finally(() => {
                            invocationInFlight = false;
                            resolveDrains();
                        });
                        return;
                    }
                } finally {
                    if (!invocationInFlight) {
                        resolveDrains();
                    }
                }
                invocationInFlight = false;
                resolveDrains();
            }, delayMs);
        },
        cancel(): void {
            if (timer !== null) {
                clock.clearTimeout(timer);
                timer = null;
            }
            latestValue = null;
            resolveDrains();
        },
        drain(): Promise<void> {
            if (timer === null && !invocationInFlight) return Promise.resolve();
            return new Promise<void>((resolve) => {
                pendingDrain.push(resolve);
            });
        },
    };
}
