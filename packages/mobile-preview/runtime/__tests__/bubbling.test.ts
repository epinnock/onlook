import { beforeEach, describe, expect, it } from 'bun:test';

import {
  __getEventParentRegistryForTests,
  __resetFabricEventsForTests,
  dispatchBubbledEvent,
  registerHostInstanceEventHandlers,
  registerHostInstanceEventParent,
} from '../host/events.js';

describe('host event bubbling', () => {
  beforeEach(() => {
    __resetFabricEventsForTests();
  });

  it('walks the parent chain for bubbling press handlers', () => {
    const calls = [];

    registerHostInstanceEventHandlers(1001, {
      onPress(event) {
        calls.push({
          label: 'child',
          currentTarget: event.currentTarget,
          target: event.target,
        });
      },
    });
    registerHostInstanceEventHandlers(1002, {
      onPress(event) {
        calls.push({
          label: 'parent',
          currentTarget: event.currentTarget,
          target: event.target,
        });
      },
    });
    registerHostInstanceEventHandlers(1003, {
      onPress(event) {
        calls.push({
          label: 'grandparent',
          currentTarget: event.currentTarget,
          target: event.target,
        });
      },
    });

    registerHostInstanceEventParent(1001, 1002);
    registerHostInstanceEventParent(1002, 1003);

    const dispatches = dispatchBubbledEvent('onPress', 'press', 1001, {
      pageX: 12,
      pageY: 30,
    });

    expect(dispatches).toHaveLength(3);
    expect(calls).toEqual([
      { label: 'child', currentTarget: 1001, target: 1001 },
      { label: 'parent', currentTarget: 1002, target: 1001 },
      { label: 'grandparent', currentTarget: 1003, target: 1001 },
    ]);
    expect(dispatches[0]?.event.nativeEvent.touches).toEqual([
      {
        pageX: 12,
        pageY: 30,
        target: 1001,
        timestamp: dispatches[0]?.event.timeStamp,
        identifier: 0,
      },
    ]);
  });

  it('stops walking ancestors when propagation is stopped', () => {
    const calls = [];

    registerHostInstanceEventHandlers(2001, {
      onPress(event) {
        calls.push(2001);
        event.stopPropagation();
      },
    });
    registerHostInstanceEventHandlers(2002, {
      onPress() {
        calls.push(2002);
      },
    });

    registerHostInstanceEventParent(2001, 2002);

    const dispatches = dispatchBubbledEvent('onPress', 'press', 2001, {});

    expect(dispatches).toHaveLength(1);
    expect(calls).toEqual([2001]);
  });

  it('skips ancestors without handlers and keeps climbing', () => {
    const calls = [];

    registerHostInstanceEventHandlers(3001, {
      onPress() {
        calls.push(3001);
      },
    });
    registerHostInstanceEventHandlers(3003, {
      onPress() {
        calls.push(3003);
      },
    });

    registerHostInstanceEventParent(3001, 3002);
    registerHostInstanceEventParent(3002, 3003);

    const dispatches = dispatchBubbledEvent('onPress', 'press', 3001, {});

    expect(dispatches).toHaveLength(2);
    expect(calls).toEqual([3001, 3003]);
  });

  it('does not bubble non-press handlers through ancestors', () => {
    const calls = [];

    registerHostInstanceEventHandlers(4001, {
      onLayout() {
        calls.push(4001);
      },
    });
    registerHostInstanceEventHandlers(4002, {
      onLayout() {
        calls.push(4002);
      },
    });

    registerHostInstanceEventParent(4001, 4002);

    const dispatches = dispatchBubbledEvent('onLayout', 'layout', 4001, {
      layout: { x: 0, y: 0, width: 10, height: 10 },
    });

    expect(dispatches).toHaveLength(1);
    expect(calls).toEqual([4001]);
    expect(__getEventParentRegistryForTests().get(4001)).toBe(4002);
  });
});
