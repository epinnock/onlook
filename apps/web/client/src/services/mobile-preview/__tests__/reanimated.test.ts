import { describe, expect, test } from 'bun:test';
import React from 'react';

const installReactNativeReanimated = require('../../../../../../../packages/mobile-preview/runtime/shims/third-party/react-native-reanimated.js');

const { MODULE_ID, RUNTIME_SHIM_REGISTRY_KEY } = installReactNativeReanimated;

function createTarget() {
    return {
        React,
        View: 'View',
        Text: 'RCTText',
        RawText: 'RCTRawText',
    };
}

describe('react-native-reanimated shim', () => {
    test('installs into __onlookShims and preserves existing registry entries', () => {
        const existingToken = Symbol('existing');
        const target = {
            ...createTarget(),
            __onlookShims: {
                'react-native-reanimated': {
                    Existing: existingToken,
                },
            },
        };

        const moduleExports = installReactNativeReanimated(target);

        expect(target[RUNTIME_SHIM_REGISTRY_KEY][MODULE_ID]).toBe(moduleExports);
        expect(moduleExports.Existing).toBe(existingToken);
        expect(moduleExports.default).toBe(moduleExports);
        expect(moduleExports.Animated).toBe(moduleExports);
        expect(moduleExports.__esModule).toBe(true);
    });

    test('returns static hook values and animation helpers', () => {
        const moduleExports = installReactNativeReanimated(createTarget());
        const sharedValue = moduleExports.useSharedValue(4);

        expect(sharedValue).toEqual({ value: 4 });
        sharedValue.value = 9;
        expect(sharedValue.value).toBe(9);
        expect(moduleExports.useDerivedValue(() => sharedValue.value * 2)).toEqual({
            value: 18,
        });
        expect(moduleExports.useAnimatedStyle(() => ({ opacity: sharedValue.value }))).toEqual({
            opacity: 9,
        });
        expect(moduleExports.useAnimatedProps(() => ({ pointerEvents: 'none' }))).toEqual({
            pointerEvents: 'none',
        });
        expect(moduleExports.withTiming(12)).toBe(12);
        expect(moduleExports.withSpring({ scale: 1.1 })).toEqual({ scale: 1.1 });
        expect(moduleExports.withDelay(120, 'delayed')).toBe('delayed');
        expect(moduleExports.withRepeat('repeated', 3)).toBe('repeated');
        expect(moduleExports.withSequence('first', 'second', 'third')).toBe('third');
        expect(moduleExports.interpolate(0.5, [0, 1], [10, 20])).toBe(15);
        expect(moduleExports.interpolate(2, [0, 1], [10, 20], 'clamp')).toBe(20);
        expect(moduleExports.interpolateColor(0, [0, 1], ['#111', '#999'])).toBe('#111');
        expect(moduleExports.interpolateColor(1, [0, 1], ['#111', '#999'])).toBe('#999');
    });

    test('renders animated wrappers as static pass-through components', () => {
        const moduleExports = installReactNativeReanimated(createTarget());
        const child = React.createElement('Child', { id: 'child' });

        const animatedView = moduleExports.View({
            testID: 'animated-view',
            children: child,
        });
        const AnimatedSection = moduleExports.createAnimatedComponent('Section');
        const animatedSection = AnimatedSection({
            accessibilityLabel: 'section',
            children: child,
        });

        expect(animatedView.type).toBe('View');
        expect(animatedView.props.testID).toBe('animated-view');
        expect(animatedView.props.children).toBe(child);
        expect(animatedSection.type).toBe('Section');
        expect(animatedSection.props.accessibilityLabel).toBe('section');
        expect(animatedSection.props.children).toBe(child);
    });

    test('exposes preview-safe runtime helpers', () => {
        const moduleExports = installReactNativeReanimated(createTarget());
        const reactionCalls: unknown[] = [];
        const scrollCalls: unknown[] = [];
        const animatedRef = moduleExports.useAnimatedRef();
        const runOnJS = moduleExports.runOnJS((value: unknown) => reactionCalls.push(value));
        const onScroll = moduleExports.useAnimatedScrollHandler({
            onScroll(event: unknown) {
                scrollCalls.push(event);
            },
        });

        moduleExports.useAnimatedReaction(
            () => 'prepared-value',
            (current: unknown, previous: unknown) =>
                reactionCalls.push({ current, previous }),
        );
        runOnJS('from-js');
        onScroll({ y: 24 });

        expect(animatedRef).toEqual({ current: null });
        expect(reactionCalls).toEqual([
            { current: 'prepared-value', previous: undefined },
            'from-js',
        ]);
        expect(scrollCalls).toEqual([{ y: 24 }]);
        expect(moduleExports.measure(animatedRef)).toBeNull();
        expect(moduleExports.Easing.linear(0.25)).toBe(0.25);
        expect(moduleExports.Extrapolate.CLAMP).toBe('clamp');
        expect(moduleExports.FadeIn.duration(200).withCallback(() => {})).toBe(
            moduleExports.FadeIn,
        );
    });
});
