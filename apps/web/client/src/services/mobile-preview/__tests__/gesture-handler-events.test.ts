import { beforeEach, describe, expect, test } from 'bun:test';
import React from 'react';

import {
    __resetFabricEventsForTests,
    registerHostInstanceEventHandlers,
    registerHostInstanceEventParent,
} from '../../../../../../../packages/mobile-preview/runtime/host/events.js';

const installReactNativeGestureHandlerRoot = require('../../../../../../../packages/mobile-preview/runtime/shims/third-party/react-native-gesture-handler-root.js');
const installReactNativeGestureHandlerEvents = require('../../../../../../../packages/mobile-preview/runtime/shims/third-party/react-native-gesture-handler-events.js');

const { MODULE_ID, RUNTIME_SHIM_REGISTRY_KEY, State } =
    installReactNativeGestureHandlerEvents;

function createTarget() {
    return {
        React,
        View: 'View',
    };
}

describe('react-native-gesture-handler events shim', () => {
    beforeEach(() => {
        __resetFabricEventsForTests();
    });

    test('installs gesture event exports into the existing react-native-gesture-handler registry entry', () => {
        const target = createTarget();
        const rootModule = installReactNativeGestureHandlerRoot(target);

        const moduleExports = installReactNativeGestureHandlerEvents(target);

        expect(target[RUNTIME_SHIM_REGISTRY_KEY][MODULE_ID]).toBe(moduleExports);
        expect(moduleExports).toBe(rootModule);
        expect(moduleExports.GestureHandlerRootView).toBeDefined();
        expect(moduleExports.State).toEqual(State);
        expect(moduleExports.TapGestureHandler.displayName).toBe('TapGestureHandler');
        expect(moduleExports.PanGestureHandler.displayName).toBe('PanGestureHandler');
        expect(moduleExports.default).toBe(moduleExports);
        expect(moduleExports.__esModule).toBe(true);
    });

    test('maps tap gestures into the current press event lifecycle', () => {
        const target = createTarget();
        const moduleExports = installReactNativeGestureHandlerEvents(target);
        const calls: Array<{
            eventName: string;
            currentTarget: number | null;
            target: number | null;
            type: string;
        }> = [];

        registerHostInstanceEventHandlers(101, {
            onPressIn(event) {
                calls.push({
                    eventName: 'onPressIn',
                    currentTarget: event.currentTarget,
                    target: event.target,
                    type: event.type,
                });
            },
            onPressOut(event) {
                calls.push({
                    eventName: 'onPressOut',
                    currentTarget: event.currentTarget,
                    target: event.target,
                    type: event.type,
                });
            },
            onPress(event) {
                calls.push({
                    eventName: 'onPress',
                    currentTarget: event.currentTarget,
                    target: event.target,
                    type: event.type,
                });
            },
        });
        registerHostInstanceEventHandlers(202, {
            onPress(event) {
                calls.push({
                    eventName: 'parent:onPress',
                    currentTarget: event.currentTarget,
                    target: event.target,
                    type: event.type,
                });
            },
        });
        registerHostInstanceEventParent(101, 202);

        const beginDispatches = moduleExports.dispatchGestureHandlerEvent(
            'onHandlerStateChange',
            101,
            {
                state: State.BEGAN,
                pageX: 12,
                pageY: 30,
            },
            { componentType: 'TapGestureHandler' },
        );
        const endDispatches = moduleExports.dispatchGestureHandlerEvent(
            'onHandlerStateChange',
            101,
            {
                state: State.END,
                pageX: 12,
                pageY: 30,
            },
            { componentType: 'TapGestureHandler' },
        );

        expect(beginDispatches).toHaveLength(1);
        expect(endDispatches).toHaveLength(3);
        expect(calls).toEqual([
            {
                eventName: 'onPressIn',
                currentTarget: 101,
                target: 101,
                type: 'topTouchStart',
            },
            {
                eventName: 'onPressOut',
                currentTarget: 101,
                target: 101,
                type: 'topTouchEnd',
            },
            {
                eventName: 'onPress',
                currentTarget: 101,
                target: 101,
                type: 'topTouchEnd',
            },
            {
                eventName: 'parent:onPress',
                currentTarget: 202,
                target: 101,
                type: 'topTouchEnd',
            },
        ]);
        expect(endDispatches[1]?.event.nativeEvent.changedTouches).toEqual([
            {
                pageX: 12,
                pageY: 30,
                target: 101,
                timestamp: endDispatches[1]?.event.timeStamp,
                identifier: 0,
            },
        ]);
    });

    test('maps long-press gestures into the shared press and long-press handlers without synthesizing an onPress', () => {
        const target = createTarget();
        const moduleExports = installReactNativeGestureHandlerEvents(target);
        const calls: string[] = [];

        registerHostInstanceEventHandlers(303, {
            onPressIn() {
                calls.push('onPressIn');
            },
            onLongPress() {
                calls.push('onLongPress');
            },
            onPressOut() {
                calls.push('onPressOut');
            },
            onPress() {
                calls.push('onPress');
            },
        });

        moduleExports.dispatchGestureHandlerEvent(
            'onHandlerStateChange',
            303,
            { state: State.BEGAN },
            { componentType: 'LongPressGestureHandler' },
        );
        moduleExports.dispatchGestureHandlerEvent(
            'onGestureEvent',
            303,
            { state: State.ACTIVE },
            { componentType: 'LongPressGestureHandler' },
        );
        moduleExports.dispatchGestureHandlerEvent(
            'onHandlerStateChange',
            303,
            { state: State.END },
            { componentType: 'LongPressGestureHandler' },
        );

        expect(calls).toEqual(['onPressIn', 'onLongPress', 'onPressOut']);
    });

    test('maps pan gestures into target-level scroll events using the shared scroll payload shape', () => {
        const target = createTarget();
        const moduleExports = installReactNativeGestureHandlerEvents(target);
        const calls: Array<{
            currentTarget: number | null;
            target: number | null;
            type: string;
            nativeEvent: Record<string, unknown>;
        }> = [];

        registerHostInstanceEventHandlers(404, {
            onScroll(event) {
                calls.push({
                    currentTarget: event.currentTarget,
                    target: event.target,
                    type: event.type,
                    nativeEvent: event.nativeEvent,
                });
            },
        });
        registerHostInstanceEventHandlers(505, {
            onScroll() {
                calls.push({
                    currentTarget: 505,
                    target: 404,
                    type: 'parent:onScroll',
                    nativeEvent: {},
                });
            },
        });
        registerHostInstanceEventParent(404, 505);

        const dispatches = moduleExports.dispatchGestureHandlerEvent(
            'onGestureEvent',
            404,
            {
                state: State.ACTIVE,
                translationX: 18,
                translationY: 240,
                velocityX: 1,
                velocityY: 6,
                layoutMeasurement: { width: 320, height: 640 },
                contentSize: { width: 320, height: 1200 },
            },
            { componentType: 'PanGestureHandler' },
        );

        expect(dispatches).toHaveLength(1);
        expect(calls).toHaveLength(1);
        expect(calls[0]).toMatchObject({
            currentTarget: 404,
            target: 404,
            type: 'topScroll',
            nativeEvent: {
                contentOffset: { x: 18, y: 240 },
                contentInset: { top: 0, left: 0, bottom: 0, right: 0 },
                contentSize: { width: 320, height: 1200 },
                layoutMeasurement: { width: 320, height: 640 },
                velocity: { x: 1, y: 6 },
                zoomScale: 1,
                responderIgnoreScroll: true,
                target: 404,
            },
        });
    });
});
