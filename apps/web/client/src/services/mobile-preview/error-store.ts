export type MobilePreviewErrorKind = 'push' | 'runtime';

import {
    formatMappedMobilePreviewRuntimeErrorMessage,
    mapMobilePreviewRuntimeError,
    type MobilePreviewMappedSourceLocation,
} from './error-mapper';

export interface MobilePreviewErrorEntry {
    kind: MobilePreviewErrorKind;
    message: string;
    occurredAt: number;
    occurrences: number;
    sourceLocation?: MobilePreviewMappedSourceLocation;
}

export interface MobilePreviewErrorPanelItem {
    id: MobilePreviewErrorKind;
    kind: MobilePreviewErrorKind;
    title: string;
    message: string;
    occurredAt: number;
    occurrences: number;
    sourceLocation?: MobilePreviewMappedSourceLocation;
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

    return {
        ...entry,
        ...(entry.sourceLocation
            ? {
                  sourceLocation: {
                      ...entry.sourceLocation,
                  },
              }
            : {}),
    };
}

function getPanelTitle(kind: MobilePreviewErrorKind): string {
    return kind === 'push' ? 'Sync error' : 'Runtime error';
}

function upsertError(
    current: MobilePreviewErrorEntry | null,
    kind: MobilePreviewErrorKind,
    message: string,
    occurredAt: number,
    sourceLocation?: MobilePreviewMappedSourceLocation | null,
): MobilePreviewErrorEntry {
    const trimmedMessage = message.trim();
    if (!trimmedMessage) {
        throw new Error('Mobile preview errors require a non-empty message.');
    }

    const sameSourceLocation =
        current?.sourceLocation?.filePath === sourceLocation?.filePath &&
        current?.sourceLocation?.line === sourceLocation?.line &&
        current?.sourceLocation?.column === sourceLocation?.column;

    if (current?.message === trimmedMessage && sameSourceLocation) {
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
        ...(sourceLocation ? { sourceLocation: { ...sourceLocation } } : {}),
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
                ...(entry.sourceLocation
                    ? {
                          sourceLocation: {
                              ...entry.sourceLocation,
                          },
                      }
                    : {}),
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
        recordRuntimeError(
            message: string,
            occurredAt = Date.now(),
            sourceLocation?: MobilePreviewMappedSourceLocation | null,
        ) {
            snapshot = {
                ...snapshot,
                runtimeError: upsertError(
                    snapshot.runtimeError,
                    'runtime',
                    message,
                    occurredAt,
                    sourceLocation,
                ),
            };

            return getSnapshot();
        },
        recordMappedRuntimeError(
            message: string,
            bundleCode: string,
            occurredAt = Date.now(),
        ) {
            const mappedError = mapMobilePreviewRuntimeError(message, bundleCode);

            return this.recordRuntimeError(
                formatMappedMobilePreviewRuntimeErrorMessage(
                    mappedError.message,
                    mappedError.sourceLocation,
                ),
                occurredAt,
                mappedError.sourceLocation,
            );
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
