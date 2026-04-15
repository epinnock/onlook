export type MobilePreviewErrorKind = 'push' | 'runtime';

export interface MobilePreviewErrorEntry {
    kind: MobilePreviewErrorKind;
    message: string;
    occurredAt: number;
    occurrences: number;
}

export interface MobilePreviewErrorPanelItem {
    id: MobilePreviewErrorKind;
    kind: MobilePreviewErrorKind;
    title: string;
    message: string;
    occurredAt: number;
    occurrences: number;
}

export interface MobilePreviewErrorPanelModel {
    isVisible: boolean;
    items: MobilePreviewErrorPanelItem[];
}

export interface MobilePreviewErrorStoreSnapshot {
    pushError: MobilePreviewErrorEntry | null;
    runtimeError: MobilePreviewErrorEntry | null;
}

function cloneEntry(
    entry: MobilePreviewErrorEntry | null,
): MobilePreviewErrorEntry | null {
    if (!entry) {
        return null;
    }

    return { ...entry };
}

function getPanelTitle(kind: MobilePreviewErrorKind): string {
    return kind === 'push' ? 'Sync error' : 'Runtime error';
}

function upsertError(
    current: MobilePreviewErrorEntry | null,
    kind: MobilePreviewErrorKind,
    message: string,
    occurredAt: number,
): MobilePreviewErrorEntry {
    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
        throw new Error('Mobile preview errors require a non-empty message.');
    }

    if (current?.message === trimmedMessage) {
        return {
            ...current,
            occurredAt,
            occurrences: current.occurrences + 1,
        };
    }

    return {
        kind,
        message: trimmedMessage,
        occurredAt,
        occurrences: 1,
    };
}

export function createMobilePreviewErrorStore(
    initialSnapshot?: Partial<MobilePreviewErrorStoreSnapshot>,
) {
    let snapshot: MobilePreviewErrorStoreSnapshot = {
        pushError: cloneEntry(initialSnapshot?.pushError ?? null),
        runtimeError: cloneEntry(initialSnapshot?.runtimeError ?? null),
    };

    const getSnapshot = (): MobilePreviewErrorStoreSnapshot => ({
        pushError: cloneEntry(snapshot.pushError),
        runtimeError: cloneEntry(snapshot.runtimeError),
    });

    const getPanelModel = (): MobilePreviewErrorPanelModel => {
        const items = [snapshot.pushError, snapshot.runtimeError]
            .filter((entry): entry is MobilePreviewErrorEntry => entry !== null)
            .sort((left, right) => right.occurredAt - left.occurredAt)
            .map((entry) => ({
                id: entry.kind,
                kind: entry.kind,
                title: getPanelTitle(entry.kind),
                message: entry.message,
                occurredAt: entry.occurredAt,
                occurrences: entry.occurrences,
            }));

        return {
            isVisible: items.length > 0,
            items,
        };
    };

    return {
        getSnapshot,
        getPanelModel,
        recordPushError(message: string, occurredAt = Date.now()) {
            snapshot = {
                ...snapshot,
                pushError: upsertError(
                    snapshot.pushError,
                    'push',
                    message,
                    occurredAt,
                ),
            };

            return getSnapshot();
        },
        clearPushError() {
            snapshot = {
                ...snapshot,
                pushError: null,
            };

            return getSnapshot();
        },
        recordRuntimeError(message: string, occurredAt = Date.now()) {
            snapshot = {
                ...snapshot,
                runtimeError: upsertError(
                    snapshot.runtimeError,
                    'runtime',
                    message,
                    occurredAt,
                ),
            };

            return getSnapshot();
        },
        clearRuntimeError() {
            snapshot = {
                ...snapshot,
                runtimeError: null,
            };

            return getSnapshot();
        },
        clearAll() {
            snapshot = {
                pushError: null,
                runtimeError: null,
            };

            return getSnapshot();
        },
    };
}
