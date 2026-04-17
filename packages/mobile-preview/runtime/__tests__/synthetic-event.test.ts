import { describe, expect, it } from 'bun:test';

import {
  createSyntheticEvent,
  createSyntheticNativeEvent,
} from '../host/synthetic-event.js';

describe('createSyntheticNativeEvent', () => {
  it('builds text-style native event payloads with target and timestamp', () => {
    const nativeEvent = createSyntheticNativeEvent(
      {
        text: 'hello',
        eventCount: 3,
      },
      {
        target: 41,
        timestamp: 123456,
      },
    );

    expect(nativeEvent).toEqual({
      text: 'hello',
      eventCount: 3,
      target: 41,
      timestamp: 123456,
    });
  });

  it('normalizes touch payloads into RN-style touches and changedTouches arrays', () => {
    const nativeEvent = createSyntheticNativeEvent(
      {
        pageX: 12,
        pageY: 30,
        locationX: 5,
        locationY: 7,
      },
      {
        target: 1000001,
        timestamp: 222,
      },
    );

    expect(nativeEvent.target).toBe(1000001);
    expect(nativeEvent.timestamp).toBe(222);
    expect(nativeEvent.touches).toEqual([
      {
        pageX: 12,
        pageY: 30,
        locationX: 5,
        locationY: 7,
        target: 1000001,
        timestamp: 222,
        identifier: 0,
      },
    ]);
    expect(nativeEvent.changedTouches).toEqual(nativeEvent.touches);
  });

  it('preserves scroll payload structure while filling common defaults', () => {
    const nativeEvent = createSyntheticNativeEvent(
      {
        contentOffset: { x: 0, y: 120 },
      },
      {
        target: 77,
        timestamp: 444,
      },
    );

    expect(nativeEvent).toEqual({
      contentOffset: { x: 0, y: 120 },
      contentInset: { top: 0, left: 0, bottom: 0, right: 0 },
      contentSize: { width: 0, height: 0 },
      layoutMeasurement: { width: 0, height: 0 },
      zoomScale: 1,
      target: 77,
      timestamp: 444,
    });
  });
});

describe('createSyntheticEvent', () => {
  it('wraps native payloads in an RN-style synthetic event interface', () => {
    const event = createSyntheticEvent(
      'topChange',
      {
        text: 'updated',
        eventCount: 2,
      },
      {
        target: 88,
        currentTarget: 99,
        timestamp: 999,
      },
    );

    expect(event.type).toBe('topChange');
    expect(event.target).toBe(88);
    expect(event.currentTarget).toBe(99);
    expect(event.timeStamp).toBe(999);
    expect(event.nativeEvent).toEqual({
      text: 'updated',
      eventCount: 2,
      target: 88,
      timestamp: 999,
    });
    expect(event.defaultPrevented).toBe(false);
    expect(event.isDefaultPrevented()).toBe(false);
    expect(event.isPropagationStopped()).toBe(false);

    event.preventDefault();
    event.stopPropagation();
    event.persist();

    expect(event.defaultPrevented).toBe(true);
    expect(event.isDefaultPrevented()).toBe(true);
    expect(event.isPropagationStopped()).toBe(true);
  });
});
