import { describe, expect, test } from 'bun:test';

import {
    deriveMobilePreviewSocketUrl,
    deriveMobilePreviewSocketUrls,
    extractProjectExpoSdkVersion,
    formatMobilePreviewRuntimeError,
    formatMobilePreviewSdkMismatchError,
    getMobilePreviewSdkMismatchMessage,
    hasMobilePreviewSdkMismatch,
    parseMobilePreviewRuntimeMessage,
    readProjectExpoSdkVersion,
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

    test('extracts the Expo SDK version from project package.json content', () => {
        expect(
            extractProjectExpoSdkVersion(
                JSON.stringify({
                    dependencies: {
                        expo: '~55.0.11',
                    },
                }),
            ),
        ).toBe('55.0.11');
        expect(extractProjectExpoSdkVersion('{')).toBeNull();
    });

    test('detects project/runtime SDK major mismatches', () => {
        expect(hasMobilePreviewSdkMismatch('55.0.11', '54.0.0')).toBe(true);
        expect(hasMobilePreviewSdkMismatch('54.0.17', '54.0.0')).toBe(false);
        expect(hasMobilePreviewSdkMismatch(null, '54.0.0')).toBe(false);
    });

    test('reads the project Expo SDK version from the mobile preview filesystem', async () => {
        expect(
            await readProjectExpoSdkVersion({
                async listAll() {
                    return [];
                },
                async readFile(path) {
                    expect(path).toBe('package.json');
                    return JSON.stringify({
                        dependencies: {
                            expo: '^54.0.20',
                        },
                    });
                },
                watchDirectory() {
                    return () => undefined;
                },
            }),
        ).toBe('54.0.20');
    });

    test('formats a clear SDK mismatch message', async () => {
        const message = await getMobilePreviewSdkMismatchMessage(
            {
                async listAll() {
                    return [];
                },
                async readFile() {
                    return JSON.stringify({
                        dependencies: {
                            expo: '~55.0.11',
                        },
                    });
                },
                watchDirectory() {
                    return () => undefined;
                },
            },
            '54.0.0',
        );

        expect(message).toBe(
            formatMobilePreviewSdkMismatchError('54.0.0', '55.0.11'),
        );
    });
});
