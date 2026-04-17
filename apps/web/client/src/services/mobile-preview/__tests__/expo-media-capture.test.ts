import { describe, expect, test } from 'bun:test';
import React from 'react';

import { wrapEvalBundle } from '../bundler/wrap-eval-bundle';

type PermissionResponse = {
    canAskAgain: boolean;
    expires: 'never';
    granted: boolean;
    status: 'granted' | 'denied' | 'undetermined';
    accessPrivileges?: 'all' | 'limited' | 'none';
};

type UsePermissionsHook = () => [
    PermissionResponse,
    () => Promise<PermissionResponse>,
    () => Promise<PermissionResponse>,
];

type CameraViewComponent = (props: Record<string, unknown>) => React.ReactElement;

type CameraModule = {
    Camera: unknown;
    CameraView: CameraViewComponent;
    CameraType: { back: 'back'; front: 'front' };
    FlashMode: Record<string, string>;
    PermissionStatus: Record<string, string>;
    useCameraPermissions: UsePermissionsHook;
    useMicrophonePermissions: UsePermissionsHook;
    default: unknown;
    __esModule: true;
    [extraKey: string]: unknown;
};

type ImagePickerModule = {
    CameraType: { back: 'back'; front: 'front' };
    MediaType: Record<string, string>;
    MediaTypeOptions: { All: 'all'; Images: 'images'; Videos: 'videos' };
    UIImagePickerPresentationStyle: Record<string, string>;
    getPendingResultAsync: () => Promise<unknown[]>;
    launchCameraAsync: () => Promise<{
        assets: null;
        canceled: true;
        cancelled: true;
    }>;
    launchImageLibraryAsync: () => Promise<{
        assets: null;
        canceled: true;
        cancelled: true;
    }>;
    useCameraPermissions: UsePermissionsHook;
    useMediaLibraryPermissions: UsePermissionsHook;
    default: unknown;
    __esModule: true;
    [extraKey: string]: unknown;
};

type MediaCaptureRegistry = {
    'expo-camera': CameraModule;
    'expo-image-picker': ImagePickerModule;
};

type RuntimeShimTarget = {
    React?: typeof React;
    TextC?: string;
    View?: string;
    __onlookShims?: Record<string, unknown>;
};

type MediaCaptureShim = {
    (target: RuntimeShimTarget): MediaCaptureRegistry;
    CAMERA_MODULE_ID: 'expo-camera';
    IMAGE_PICKER_MODULE_ID: 'expo-image-picker';
    RUNTIME_SHIM_REGISTRY_KEY: '__onlookShims';
};

const installExpoMediaCaptureShim = require('../../../../../../../packages/mobile-preview/runtime/shims/expo/media-capture.js') as MediaCaptureShim;

const {
    CAMERA_MODULE_ID,
    IMAGE_PICKER_MODULE_ID,
    RUNTIME_SHIM_REGISTRY_KEY,
} = installExpoMediaCaptureShim;

function createTarget(): RuntimeShimTarget {
    return {
        React,
        TextC: 'Text',
        View: 'View',
    };
}

type FunctionalReactElement = Omit<React.ReactElement, 'type'> & {
    type: (props: unknown) => React.ReactElement;
};

function resolveRenderedElement(element: React.ReactElement): React.ReactElement {
    if (typeof element.type !== 'function') {
        return element;
    }

    return (element as FunctionalReactElement).type(element.props);
}

type RuntimeGlobalState = {
    React?: typeof React;
    RawText?: string;
    TextC?: string;
    View?: string;
    __imagePickerPromise?: Promise<unknown>;
    __onlookShims?: Record<string, unknown>;
    renderApp?: (element: unknown) => void;
};

function withRuntimeGlobals(
    run: (
        runtimeGlobal: typeof globalThis & RuntimeGlobalState,
    ) => Promise<void> | void,
) {
    const runtimeGlobal = globalThis as typeof globalThis & RuntimeGlobalState;
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
        const runtimeShims = target[RUNTIME_SHIM_REGISTRY_KEY];
        if (!runtimeShims) {
            throw new Error('expected runtime shim registry to be installed');
        }
        const cameraModule = runtimeShims[CAMERA_MODULE_ID] as CameraModule;
        const imagePickerModule = runtimeShims[
            IMAGE_PICKER_MODULE_ID
        ] as ImagePickerModule;

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
        const cameraViewProps = cameraView.props as {
            children?: React.ReactNode;
            style?: { flex?: number };
            testID?: string;
        };
        expect(cameraView.type).toBe('View');
        expect(cameraViewProps.children).toBe('Camera preview');
        expect(cameraViewProps.style).toEqual({ flex: 1 });
        expect(cameraViewProps.testID).toBe('camera-view');
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
        const target: RuntimeShimTarget = {
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
        const registry = target.__onlookShims as Record<string, unknown>;

        expect(cameraModule).toBe(registry['expo-camera'] as CameraModule);
        expect(cameraModule.CameraView).toBe(existingCamera as unknown as CameraViewComponent);
        expect(cameraModule.Camera).toBe(existingCamera);
        expect(cameraModule.useCameraPermissions).toBeFunction();
        expect(cameraModule.default).toBe(existingCamera);
        expect(cameraModule.__esModule).toBe(true);

        expect(imagePickerModule).toBe(registry['expo-image-picker'] as ImagePickerModule);
        expect(imagePickerModule.Existing).toBe(existingImagePicker);
        expect(imagePickerModule.launchImageLibraryAsync).toBe(
            customLaunchImageLibraryAsync as unknown as ImagePickerModule['launchImageLibraryAsync'],
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
            const renderedProps = rendered.props as {
                children?: React.ReactNode;
                testID?: string;
            };

            expect(rendered.type).toBe('View');
            expect(renderedProps.testID).toBe('camera-root');
            expect(renderedProps.children).toBe('granted');
            expect(imagePickerResult).toEqual({
                assets: null,
                canceled: true,
                cancelled: true,
            });
        });
    });
});
