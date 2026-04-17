import { describe, expect, test } from 'bun:test';

import { createMobilePreviewErrorStore } from '../error-store';

describe('mobile preview error store', () => {
    test('records push errors and exposes a visible panel model', () => {
        const store = createMobilePreviewErrorStore();

        store.recordPushError('mobile-preview /push returned 503', 10);

        expect(store.getSnapshot()).toEqual({
            pushError: {
                kind: 'push',
                message: 'mobile-preview /push returned 503',
                occurredAt: 10,
                occurrences: 1,
            },
            runtimeError: null,
        });
        expect(store.getPanelModel()).toEqual({
            isVisible: true,
            items: [
                {
                    id: 'push',
                    kind: 'push',
                    title: 'Sync error',
                    message: 'mobile-preview /push returned 503',
                    occurredAt: 10,
                    occurrences: 1,
                },
            ],
        });
    });

    test('deduplicates repeated runtime errors and bumps the occurrence count', () => {
        const store = createMobilePreviewErrorStore();

        store.recordRuntimeError('Unexpected token <', 10);
        store.recordRuntimeError('Unexpected token <', 20);

        expect(store.getSnapshot().runtimeError).toEqual({
            kind: 'runtime',
            message: 'Unexpected token <',
            occurredAt: 20,
            occurrences: 2,
        });
    });

    test('orders panel items from newest to oldest across error kinds', () => {
        const store = createMobilePreviewErrorStore();

        store.recordPushError('push failed', 10);
        store.recordRuntimeError('boom', 25);

        expect(store.getPanelModel().items.map((item) => item.id)).toEqual([
            'runtime',
            'push',
        ]);
    });

    test('clears resolved errors and hides the panel when empty', () => {
        const store = createMobilePreviewErrorStore();

        store.recordPushError('push failed', 10);
        store.recordRuntimeError('boom', 20);
        store.clearRuntimeError();
        store.clearPushError();

        expect(store.getSnapshot()).toEqual({
            pushError: null,
            runtimeError: null,
        });
        expect(store.getPanelModel()).toEqual({
            isVisible: false,
            items: [],
        });
    });
});
