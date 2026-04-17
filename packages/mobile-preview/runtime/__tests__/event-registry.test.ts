import { beforeEach, describe, expect, it } from 'bun:test';

import { createHostInstance } from '../host/instance.js';
import {
  __getEventHandlerRegistryForTests,
  __resetFabricEventsForTests,
  getHostInstanceEventHandlers,
} from '../host/events.js';
import { resetHostTagCounter } from '../host/tags.js';

describe('host event registry', () => {
  beforeEach(() => {
    resetHostTagCounter();
    __resetFabricEventsForTests();
  });

  it('registers function-valued on* props under the host instance tag', () => {
    const onPress = () => {};
    const onPressIn = () => {};
    const onLayout = () => {};
    const fab = {
      createNode(tag, type, rootTag, props, internalHandle) {
        return { tag, type, rootTag, props, internalHandle };
      },
    };

    const instance = createHostInstance(
      fab,
      41,
      'Pressable',
      {
        onPress,
        onPressIn,
        onLayout,
        title: 'ignored',
        onMagic: 'not-a-handler',
      },
      { fiber: true },
    );

    expect(instance.tag).toBe(1000000);
    expect(instance.handlers).toEqual({
      onPress,
      onPressIn,
      onLayout,
    });
    expect(getHostInstanceEventHandlers(instance.tag)).toEqual({
      onPress,
      onPressIn,
      onLayout,
    });
  });

  it('keeps the registry empty for instances without event handlers', () => {
    const fab = {
      createNode(tag, type, rootTag, props, internalHandle) {
        return { tag, type, rootTag, props, internalHandle };
      },
    };

    const instance = createHostInstance(
      fab,
      41,
      'View',
      {
        accessibilityLabel: 'hero',
        pointerEvents: 'none',
      },
      null,
    );

    expect(instance.handlers).toEqual({});
    expect(getHostInstanceEventHandlers(instance.tag)).toBeNull();
    expect(__getEventHandlerRegistryForTests().size).toBe(0);
  });
});
