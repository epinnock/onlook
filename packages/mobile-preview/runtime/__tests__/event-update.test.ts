import { beforeEach, describe, expect, it } from 'bun:test';

import {
  __resetFabricEventsForTests,
  getHostInstanceEventHandlers,
  registerHostInstanceEventHandlers,
} from '../host/events.js';
import { commitHostInstanceUpdate } from '../host/update.js';

describe('host event updates', () => {
  beforeEach(() => {
    __resetFabricEventsForTests();
  });

  it('replaces stale handlers during commit updates', () => {
    const onPressBefore = () => {};
    const onPressAfter = () => {};
    const onLayoutAfter = () => {};
    const cloneCalls = [];

    const fab = {
      cloneNodeWithNewProps(node, props) {
        cloneCalls.push({ node, props });
        return { ...node, props };
      },
    };

    const instance = {
      tag: 1000001,
      node: { kind: 'node', tag: 1000001, props: { testID: 'before' } },
      handlers: registerHostInstanceEventHandlers(1000001, { onPress: onPressBefore }),
    };

    commitHostInstanceUpdate(
      fab,
      instance,
      { testID: 'after' },
      { onPress: onPressAfter, onLayout: onLayoutAfter, testID: 'after' },
    );

    expect(cloneCalls).toEqual([
      {
        node: { kind: 'node', tag: 1000001, props: { testID: 'before' } },
        props: { testID: 'after' },
      },
    ]);
    expect(instance.handlers).toEqual({
      onPress: onPressAfter,
      onLayout: onLayoutAfter,
    });
    expect(getHostInstanceEventHandlers(1000001)).toEqual({
      onPress: onPressAfter,
      onLayout: onLayoutAfter,
    });
  });

  it('removes registry entries when updated props no longer contain handlers', () => {
    const fab = {
      cloneNodeWithNewProps(node, props) {
        return { ...node, props };
      },
    };

    const instance = {
      tag: 1000002,
      node: { kind: 'node', tag: 1000002, props: { accessible: true } },
      handlers: registerHostInstanceEventHandlers(1000002, { onPress: () => {} }),
    };

    commitHostInstanceUpdate(fab, instance, { accessible: false }, { accessible: false });

    expect(instance.handlers).toEqual({});
    expect(getHostInstanceEventHandlers(1000002)).toBeNull();
  });
});
