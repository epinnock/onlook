import { afterEach, describe, expect, test } from 'bun:test';
import React from 'react';

const installExpoAvShim = require('../../../../../../../packages/mobile-preview/runtime/shims/expo/expo-av.js');
const expoRuntimeShimCollection = require('../../../../../../../packages/mobile-preview/runtime/shims/expo/index.js');
const {
    applyRuntimeShims,
    getRegisteredRuntimeShimIds,
    registerRuntimeShim,
    resetRuntimeShimRegistry,
} = require('../../../../../../../packages/mobile-preview/runtime/registry.js');

const { AV_STATE_KEY, MODULE_ID, RUNTIME_SHIM_REGISTRY_KEY } =
    installExpoAvShim;

type RuntimeTarget = {
    React: typeof React;
    View: string;
    __onlookShims?: Record<string, Record<string, unknown>>;
    __onlookExpoAvState?: Record<string, unknown>;
};

function createTarget(): RuntimeTarget {
    return {
        React,
        View: 'View',
    };
}

afterEach(() => {
    resetRuntimeShimRegistry();
});

describe('expo-av shim', () => {
    test('installs preview-safe Audio and Video exports into __onlookShims', () => {
        const target = createTarget();

        const moduleExports = installExpoAvShim(target);

        const shimRegistry = target.__onlookShims ?? {};
        expect(shimRegistry[MODULE_ID as string]).toBe(moduleExports);
        expect(moduleExports.default).toBe(moduleExports);
        expect(moduleExports.__esModule).toBe(true);
        expect(moduleExports.Audio.Sound).toBeFunction();
        expect(moduleExports.Audio.Recording).toBeFunction();
        expect(moduleExports.ResizeMode).toEqual({
            CONTAIN: 'contain',
            COVER: 'cover',
            STRETCH: 'stretch',
        });
        expect(moduleExports.InterruptionModeIOS).toEqual({
            MixWithOthers: 0,
            DoNotMix: 1,
            DuckOthers: 2,
        });
        expect(moduleExports.InterruptionModeAndroid).toEqual({
            DoNotMix: 1,
            DuckOthers: 2,
        });

        const video = moduleExports.Video({
            accessibilityLabel: 'Inline video',
            children: 'Poster',
            resizeMode: moduleExports.ResizeMode.COVER,
            source: { uri: 'https://example.com/video.mp4' },
            style: { aspectRatio: 16 / 9 },
            testID: 'expo-video',
        });

        expect(video.type).toBe('View');
        expect(video.props.children).toBe('Poster');
        expect(video.props.style).toEqual({ aspectRatio: 16 / 9 });
        expect(video.props.testID).toBe('expo-video');
        expect(video.props.accessibilityLabel).toBe('Inline video');
        expect(video.props).not.toHaveProperty('resizeMode');
        expect(video.props).not.toHaveProperty('source');
    });

    test('keeps playback and recording helpers stateful but preview-safe', async () => {
        const target = createTarget();
        const moduleExports = installExpoAvShim(target);
        const playbackUpdates: Array<Record<string, unknown>> = [];
        const recordingUpdates: Array<Record<string, unknown>> = [];

        await expect(moduleExports.Audio.getPermissionsAsync()).resolves.toEqual(
            expect.objectContaining({
                granted: true,
                status: 'granted',
            }),
        );
        await expect(
            moduleExports.Audio.requestRecordingPermissionsAsync(),
        ).resolves.toEqual(
            expect.objectContaining({
                granted: true,
                status: 'granted',
            }),
        );

        await moduleExports.Audio.setAudioModeAsync({
            playsInSilentModeIOS: true,
        });
        await moduleExports.Audio.setIsEnabledAsync(false);

        expect(target.__onlookExpoAvState).toEqual(
            expect.objectContaining({
                audioMode: {
                    playsInSilentModeIOS: true,
                },
                enabled: false,
                nextRecordingId: 0,
            }),
        );

        const sound = new moduleExports.Audio.Sound();
        sound.setOnPlaybackStatusUpdate((status: Record<string, unknown>) => {
            playbackUpdates.push(status);
        });

        const loadStatus = await sound.loadAsync(
            { uri: 'https://example.com/audio.mp3' },
            { shouldPlay: true, volume: 0.25 },
        );

        expect(loadStatus).toEqual(
            expect.objectContaining({
                isLoaded: true,
                isPlaying: true,
                shouldPlay: true,
                uri: 'https://example.com/audio.mp3',
                volume: 0.25,
            }),
        );
        expect(sound.getURI()).toBe('https://example.com/audio.mp3');

        await sound.pauseAsync();
        await sound.playFromPositionAsync(240);
        await sound.setIsMutedAsync(true);
        await sound.setRateAsync(1.5, true, 'medium');
        await sound.setProgressUpdateIntervalAsync(250);

        expect(await sound.getStatusAsync()).toEqual(
            expect.objectContaining({
                isMuted: true,
                isPlaying: true,
                pitchCorrectionQuality: 'medium',
                positionMillis: 240,
                progressUpdateIntervalMillis: 250,
                rate: 1.5,
                shouldCorrectPitch: true,
            }),
        );
        expect(playbackUpdates).not.toHaveLength(0);

        const createdSound = await moduleExports.Audio.Sound.createAsync(
            { uri: 'https://example.com/created.mp3' },
            { shouldPlay: false },
        );

        expect(createdSound.status).toEqual(
            expect.objectContaining({
                isLoaded: true,
                isPlaying: false,
                shouldPlay: false,
                uri: 'https://example.com/created.mp3',
            }),
        );

        const createdRecording =
            await moduleExports.Audio.Recording.createAsync(
                moduleExports.Audio.RecordingOptionsPresets.HIGH_QUALITY,
                (status: Record<string, unknown>) => {
                    recordingUpdates.push(status);
                },
                200,
            );

        expect(createdRecording.status).toEqual(
            expect.objectContaining({
                canRecord: true,
                isDoneRecording: false,
                isRecording: false,
                progressUpdateIntervalMillis: 200,
            }),
        );

        await createdRecording.recording.startAsync();
        const recordingStatus =
            await createdRecording.recording.stopAndUnloadAsync();

        expect(recordingStatus).toEqual(
            expect.objectContaining({
                canRecord: false,
                isDoneRecording: true,
                isRecording: false,
                uri: 'file:///onlook-recording-1.m4a',
            }),
        );
        expect(createdRecording.recording.getURI()).toBe(
            'file:///onlook-recording-1.m4a',
        );
        expect(recordingUpdates).not.toHaveLength(0);

        const loadedFromRecording =
            await createdRecording.recording.createNewLoadedSoundAsync({
                shouldPlay: true,
            });

        expect(loadedFromRecording.status).toEqual(
            expect.objectContaining({
                isLoaded: true,
                isPlaying: true,
                shouldPlay: true,
                uri: 'file:///onlook-recording-1.m4a',
            }),
        );
    });

    test('merges into an existing expo-av registry entry', () => {
        const existingAudio = Symbol('Audio');
        const target = {
            ...createTarget(),
            __onlookShims: {
                'expo-av': {
                    Audio: existingAudio,
                },
            },
        };

        const moduleExports = installExpoAvShim(target);

        expect(moduleExports).toBe(target.__onlookShims['expo-av']);
        expect(moduleExports.Audio).toBe(existingAudio);
        expect(moduleExports.Video).toBeFunction();
        expect(moduleExports.ResizeMode).toBeDefined();
        expect(moduleExports.default).toBe(moduleExports);
        expect(moduleExports.__esModule).toBe(true);
    });
});

describe('expo runtime shim auto-discovery', () => {
    test('derives expo-av from the expo shim collection path rules', () => {
        const applied: string[] = [];

        registerRuntimeShim(
            function installExpoAv(target: { applied: string[] }) {
                target.applied.push('expo-av');
            },
            './shims/expo/expo-av.js',
        );
        registerRuntimeShim(expoRuntimeShimCollection, './shims/expo/index.js');

        applyRuntimeShims({ applied });

        expect(getRegisteredRuntimeShimIds()).toEqual(['expo-av']);
        expect(applied).toEqual(['expo-av']);
    });
});
