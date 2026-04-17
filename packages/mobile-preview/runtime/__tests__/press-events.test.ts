import { beforeEach, describe, expect, it } from 'bun:test';

import {
  __resetFabricEventsForTests,
  registerHostInstanceEventHandlers,
  registerHostInstanceEventParent,
} from '../host/events.js';
import {
  dispatchPressEvent,
  isPressComponentType,
  resolvePressEventHandlerNames,
} from '../host/events-press.js';

describe('press event dispatch', () => {
  beforeEach(() => {
    __resetFabricEventsForTests();
  });

  it('recognizes the supported press component families', () => {
    expect(isPressComponentType('Pressable')).toBe(true);
    expect(isPressComponentType('TouchableOpacity')).toBe(true);
    expect(isPressComponentType('TouchableHighlight')).toBe(true);
    expect(isPressComponentType('TouchableWithoutFeedback')).toBe(true);
    expect(isPressComponentType('Button')).toBe(true);
    expect(isPressComponentType('View')).toBe(false);
  });

  it('maps touch start/end phases to press handler names', () => {
    expect(resolvePressEventHandlerNames('topTouchStart', 'Pressable')).toEqual([
      'onPressIn',
    ]);
    expect(resolvePressEventHandlerNames('topTouchEnd', 'Pressable')).toEqual([
      'onPressOut',
      'onPress',
    ]);
    expect(resolvePressEventHandlerNames('longPress', 'TouchableOpacity')).toEqual([
      'onLongPress',
    ]);
    expect(resolvePressEventHandlerNames('topTouchEnd', 'Button')).toEqual([
      'onPress',
    ]);
  });

  it('dispatches press lifecycle handlers through the existing bubbling system', () => {
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

    const startDispatches = dispatchPressEvent(
      'topTouchStart',
      101,
      { pageX: 12, pageY: 30 },
      { componentType: 'Pressable' },
    );
    const endDispatches = dispatchPressEvent(
      'topTouchEnd',
      101,
      { pageX: 12, pageY: 30 },
      { componentType: 'Pressable' },
    );

    expect(startDispatches).toHaveLength(1);
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

  it('limits Button dispatches to onPress only', () => {
    const calls: string[] = [];

    registerHostInstanceEventHandlers(303, {
      onPress() {
        calls.push('onPress');
      },
      onPressIn() {
        calls.push('onPressIn');
      },
      onPressOut() {
        calls.push('onPressOut');
      },
    });

    const startDispatches = dispatchPressEvent(
      'topTouchStart',
      303,
      {},
      { componentType: 'Button' },
    );
    const endDispatches = dispatchPressEvent(
      'topTouchEnd',
      303,
      {},
      { componentType: 'Button' },
    );

    expect(startDispatches).toEqual([]);
    expect(endDispatches).toHaveLength(1);
    expect(calls).toEqual(['onPress']);
  });
});
