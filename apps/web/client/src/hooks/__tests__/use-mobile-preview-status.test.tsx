import { describe, expect, test } from 'bun:test';

import {
    deriveMobilePreviewSocketUrl,
    deriveMobilePreviewSocketUrls,
    formatMobilePreviewRuntimeError,
    parseMobilePreviewRuntimeMessage,
    reduceMobilePreviewRuntimeMessage,
} from '../use-mobile-preview-status';

describe('useMobilePreviewStatus helpers', () => {
    test('derives the mobile-preview websocket URL from the HTTP base URL', () => {
        expect(deriveMobilePreviewSocketUrl('http://127.0.0.1:8787')).toBe(
            'ws://127.0.0.1:8788/',
        );
        expect(deriveMobilePreviewSocketUrl('https://preview.onlook.com')).toBe(
            'wss://preview.onlook.com/',
        );
        expect(deriveMobilePreviewSocketUrls('http://127.0.0.1:8787')).toEqual([
            'ws://127.0.0.1:8788/',
            'ws://127.0.0.1:8887/',
        ]);
    });

    test('parses runtime eval error messages', () => {
        expect(
            parseMobilePreviewRuntimeMessage(
                '{"type":"evalError","error":"Unexpected token <"}',
            ),
        ).toEqual({
            type: 'evalError',
            error: 'Unexpected token <',
        });
        expect(parseMobilePreviewRuntimeMessage('not-json')).toBeNull();
    });

    test('turns a runtime eval error into a modal error state', () => {
        expect(
            reduceMobilePreviewRuntimeMessage({
                data: '{"type":"evalError","error":"boom"}',
                isOpen: true,
                lastReadyStatus: {
                    kind: 'ready',
                    manifestUrl: 'exp://preview.test/manifest/hash',
                    qrSvg: '<svg />',
                },
                runtimeErrorMessage: null,
            }),
        ).toEqual({
            nextStatus: {
                kind: 'error',
                message: formatMobilePreviewRuntimeError('boom'),
            },
            runtimeErrorMessage: 'boom',
        });
    });

    test('restores the last ready state after a successful eval result', () => {
        expect(
            reduceMobilePreviewRuntimeMessage({
                data: '{"type":"evalResult","result":"ok"}',
                isOpen: true,
                lastReadyStatus: {
                    kind: 'ready',
                    manifestUrl: 'exp://preview.test/manifest/hash',
                    qrSvg: '<svg />',
                },
                runtimeErrorMessage: 'boom',
            }),
        ).toEqual({
            nextStatus: {
                kind: 'ready',
                manifestUrl: 'exp://preview.test/manifest/hash',
                qrSvg: '<svg />',
            },
            runtimeErrorMessage: null,
        });
    });
});
