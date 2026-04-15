import { describe, expect, test } from 'bun:test';
import React from 'react';

import { wrapEvalBundle } from '../bundler/wrap-eval-bundle';

const installExpoMediaCaptureShim = require('../../../../../../../packages/mobile-preview/runtime/shims/expo/media-capture.js');

const {
    CAMERA_MODULE_ID,
    IMAGE_PICKER_MODULE_ID,
    RUNTIME_SHIM_REGISTRY_KEY,
} = installExpoMediaCaptureShim;

function createTarget() {
    return {
        React,
        TextC: 'Text',
        View: 'View',
    };
}

function resolveRenderedElement(element: React.ReactElement) {
    if (typeof element.type !== 'function') {
        return element;
    }

    return element.type(element.props);
}

function withRuntimeGlobals(run: (runtimeGlobal: typeof globalThis) => Promise<void> | void) {
    const runtimeGlobal = globalThis as typeof globalThis & {
        React?: typeof React;
        RawText?: string;
        TextC?: string;
        View?: string;
        __imagePickerPromise?: Promise<unknown>;
        __onlookShims?: Record<string, unknown>;
        renderApp?: (element: unknown) => void;
    };
    const previousState = {
        React: runtimeGlobal.React,
        RawText: runtimeGlobal.RawText,
        TextC: runtimeGlobal.TextC,
        View: runtimeGlobal.View,
        imagePickerPromise: runtimeGlobal.__imagePickerPromise,
        renderApp: runtimeGlobal.renderApp,
        runtimeShims: runtimeGlobal.__onlookShims,
    };

    runtimeGlobal.React = React;
    runtimeGlobal.RawText = 'RCTRawText';
    runtimeGlobal.TextC = 'Text';
    runtimeGlobal.View = 'View';

    return Promise.resolve()
        .then(() => run(runtimeGlobal))
        .finally(() => {
            runtimeGlobal.React = previousState.React;
            runtimeGlobal.RawText = previousState.RawText;
            runtimeGlobal.TextC = previousState.TextC;
            runtimeGlobal.View = previousState.View;
            runtimeGlobal.renderApp = previousState.renderApp;

            if (previousState.imagePickerPromise === undefined) {
                delete runtimeGlobal.__imagePickerPromise;
            } else {
                runtimeGlobal.__imagePickerPromise = previousState.imagePickerPromise;
            }

            if (previousState.runtimeShims === undefined) {
                delete runtimeGlobal.__onlookShims;
            } else {
                runtimeGlobal.__onlookShims = previousState.runtimeShims;
            }
        });
}

describe('expo media-capture shim', () => {
    test('installs expo-camera and expo-image-picker into __onlookShims', async () => {
        const target = createTarget();

        const installedModules = installExpoMediaCaptureShim(target);
        const cameraModule =
            target[RUNTIME_SHIM_REGISTRY_KEY][CAMERA_MODULE_ID];
        const imagePickerModule =
            target[RUNTIME_SHIM_REGISTRY_KEY][IMAGE_PICKER_MODULE_ID];

        expect(installedModules[CAMERA_MODULE_ID]).toBe(cameraModule);
        expect(installedModules[IMAGE_PICKER_MODULE_ID]).toBe(
            imagePickerModule,
        );
        expect(cameraModule.default).toBe(cameraModule);
        expect(imagePickerModule.default).toBe(imagePickerModule);
        expect(cameraModule.__esModule).toBe(true);
        expect(imagePickerModule.__esModule).toBe(true);

        const [cameraPermission, requestCameraPermission, getCameraPermission] =
            cameraModule.useCameraPermissions();
        const cameraView = cameraModule.CameraView({
            children: 'Camera preview',
            enableTorch: true,
            facing: cameraModule.CameraType.front,
            style: { flex: 1 },
            testID: 'camera-view',
        });
        const [mediaLibraryPermission] =
            imagePickerModule.useMediaLibraryPermissions();

        expect(cameraPermission).toEqual({
            canAskAgain: true,
            expires: 'never',
            granted: true,
            status: 'granted',
        });
        expect(await requestCameraPermission()).toEqual(cameraPermission);
        expect(await getCameraPermission()).toEqual(cameraPermission);
        expect(cameraView.type).toBe('View');
        expect(cameraView.props.children).toBe('Camera preview');
        expect(cameraView.props.style).toEqual({ flex: 1 });
        expect(cameraView.props.testID).toBe('camera-view');
        expect(cameraView.props).not.toHaveProperty('enableTorch');
        expect(cameraView.props).not.toHaveProperty('facing');

        expect(mediaLibraryPermission).toEqual({
            accessPrivileges: 'all',
            canAskAgain: true,
            expires: 'never',
            granted: true,
            status: 'granted',
        });
        expect(imagePickerModule.MediaTypeOptions.Images).toBe('images');
        expect(await imagePickerModule.launchImageLibraryAsync()).toEqual({
            assets: null,
            canceled: true,
            cancelled: true,
        });
        expect(await imagePickerModule.launchCameraAsync()).toEqual({
            assets: null,
            canceled: true,
            cancelled: true,
        });
        expect(await imagePickerModule.getPendingResultAsync()).toEqual([]);
    });

    test('merges into existing expo-camera and expo-image-picker registry entries', () => {
        const existingCamera = Symbol('existingCamera');
        const existingImagePicker = Symbol('existingImagePicker');
        const customLaunchImageLibraryAsync = () =>
            Promise.resolve({ canceled: false });
        const target = {
            ...createTarget(),
            __onlookShims: {
                'expo-camera': {
                    CameraView: existingCamera,
                },
                'expo-image-picker': {
                    Existing: existingImagePicker,
                    launchImageLibraryAsync: customLaunchImageLibraryAsync,
                },
            },
        };

        const installedModules = installExpoMediaCaptureShim(target);
        const cameraModule = installedModules[CAMERA_MODULE_ID];
        const imagePickerModule = installedModules[IMAGE_PICKER_MODULE_ID];

        expect(cameraModule).toBe(target.__onlookShims['expo-camera']);
        expect(cameraModule.CameraView).toBe(existingCamera);
        expect(cameraModule.Camera).toBe(existingCamera);
        expect(cameraModule.useCameraPermissions).toBeFunction();
        expect(cameraModule.default).toBe(existingCamera);
        expect(cameraModule.__esModule).toBe(true);

        expect(imagePickerModule).toBe(target.__onlookShims['expo-image-picker']);
        expect(imagePickerModule.Existing).toBe(existingImagePicker);
        expect(imagePickerModule.launchImageLibraryAsync).toBe(
            customLaunchImageLibraryAsync,
        );
        expect(imagePickerModule.launchCameraAsync).toBeFunction();
        expect(imagePickerModule.default).toBe(imagePickerModule);
        expect(imagePickerModule.__esModule).toBe(true);
    });
});

describe('wrapEvalBundle runtime shim resolution', () => {
    test('loads expo-camera and expo-image-picker from __onlookShims', async () => {
        await withRuntimeGlobals(async (runtimeGlobal) => {
            const renderAppCalls: unknown[] = [];

            installExpoMediaCaptureShim(runtimeGlobal);
            runtimeGlobal.renderApp = (element) => {
                renderAppCalls.push(element);
            };

            const code = wrapEvalBundle('App.js', ['App.js'], {
                'App.js': `
                    const React = require('react');
                    const { CameraView, useCameraPermissions } = require('expo-camera');
                    const ImagePicker = require('expo-image-picker');

                    globalThis.__imagePickerPromise = ImagePicker.launchImageLibraryAsync({
                        mediaTypes: [ImagePicker.MediaType.images],
                    });

                    module.exports = function App() {
                        const [permission] = useCameraPermissions();
                        return React.createElement(CameraView, { testID: 'camera-root' }, permission.status);
                    };
                `,
            });

            (0, eval)(code);

            expect(renderAppCalls).toHaveLength(1);

            const appElement = resolveRenderedElement(
                renderAppCalls[0] as React.ReactElement,
            );
            const rendered = resolveRenderedElement(
                appElement as React.ReactElement,
            );
            const imagePickerResult = await runtimeGlobal.__imagePickerPromise;

            expect(rendered.type).toBe('View');
            expect(rendered.props.testID).toBe('camera-root');
            expect(rendered.props.children).toBe('granted');
            expect(imagePickerResult).toEqual({
                assets: null,
                canceled: true,
                cancelled: true,
            });
        });
    });
});
