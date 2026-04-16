/**
 * DevMenuTrigger — MC5.10 of plans/onlook-mobile-client-task-queue.md.
 *
 * Transparent wrapper that detects a three-finger long-press gesture
 * (3 simultaneous touches held for 800ms) and fires `onTrigger`.
 *
 * The component renders its children normally and only intercepts the
 * gesture — it adds no visual footprint of its own.
 *
 * Uses React Native's PanResponder to monitor touch count. A timer starts
 * when 3+ fingers are detected; if all fingers remain down for the
 * configured duration the callback fires.
 */

import React, { useCallback, useRef } from 'react';
import {
    type GestureResponderEvent,
    PanResponder,
    type PanResponderInstance,
    View,
} from 'react-native';

/** Minimum number of simultaneous touches required. */
const REQUIRED_TOUCHES = 3;

/** Duration (ms) fingers must be held before the trigger fires. */
const LONG_PRESS_DURATION = 800;

interface DevMenuTriggerProps {
    /** Content to render inside the gesture-detecting wrapper. */
    children: React.ReactNode;
    /** Callback fired when the three-finger long-press is detected. */
    onTrigger: () => void;
    /** When true, gesture detection is disabled. */
    disabled?: boolean;
}

export default function DevMenuTrigger({
    children,
    onTrigger,
    disabled = false,
}: DevMenuTriggerProps) {
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const firedRef = useRef(false);

    const clearTimer = useCallback(() => {
        if (timerRef.current !== null) {
            clearTimeout(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    const startTimer = useCallback(() => {
        clearTimer();
        firedRef.current = false;
        timerRef.current = setTimeout(() => {
            firedRef.current = true;
            onTrigger();
        }, LONG_PRESS_DURATION);
    }, [clearTimer, onTrigger]);

    const panResponder = useRef<PanResponderInstance>(
        PanResponder.create({
            onStartShouldSetPanResponder: (evt: GestureResponderEvent) => {
                if (disabled) return false;
                return evt.nativeEvent.touches.length >= REQUIRED_TOUCHES;
            },

            onMoveShouldSetPanResponder: () => false,

            onPanResponderGrant: (_evt: GestureResponderEvent) => {
                if (!disabled) {
                    startTimer();
                }
            },

            onPanResponderMove: (evt: GestureResponderEvent) => {
                // If the user lifts a finger so fewer than 3 remain, cancel.
                if (evt.nativeEvent.touches.length < REQUIRED_TOUCHES) {
                    clearTimer();
                }
            },

            onPanResponderRelease: () => {
                clearTimer();
            },

            onPanResponderTerminate: () => {
                clearTimer();
            },
        }),
    ).current;

    return (
        <View style={{ flex: 1 }} {...panResponder.panHandlers}>
            {children}
        </View>
    );
}
