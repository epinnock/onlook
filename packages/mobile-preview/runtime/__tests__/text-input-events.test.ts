import { beforeEach, describe, expect, it, mock } from 'bun:test';

import { registerHostInstanceEventHandlers } from '../host/events.js';
import {
  __resetTextInputEventStateForTests,
  dispatchTextInputChangeEvent,
} from '../host/events-text-input.js';

describe('dispatchTextInputChangeEvent', () => {
  beforeEach(() => {
    __resetTextInputEventStateForTests();
  });

  it('returns null when the host tag has no registered handlers', () => {
    expect(dispatchTextInputChangeEvent(1000001, 'hello')).toBeNull();
  });

  it('dispatches a synthetic onChange event and an onChangeText callback', () => {
    const onChange = mock(() => {});
    const onChangeText = mock(() => {});

    registerHostInstanceEventHandlers(1000001, {
      onChange,
      onChangeText,
    });

    const event = dispatchTextInputChangeEvent(1000001, 'updated', {
      timestamp: 98765,
    });

    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChangeText).toHaveBeenCalledTimes(1);
    expect(onChangeText).toHaveBeenCalledWith('updated');
    expect(event).toEqual({
      type: 'topChange',
      target: 1000001,
      currentTarget: 1000001,
      nativeEvent: {
        text: 'updated',
        eventCount: 1,
        target: 1000001,
        timestamp: 98765,
      },
      timeStamp: 98765,
      defaultPrevented: false,
      preventDefault: expect.any(Function),
      isDefaultPrevented: expect.any(Function),
      stopPropagation: expect.any(Function),
      isPropagationStopped: expect.any(Function),
      persist: expect.any(Function),
    });
    expect(onChange.mock.calls[0][0]).toBe(event);
  });

  it('increments eventCount for repeated changes on the same host tag', () => {
    const onChange = mock(() => {});

    registerHostInstanceEventHandlers(1000001, {
      onChange,
    });

    const firstEvent = dispatchTextInputChangeEvent(1000001, 'first');
    const secondEvent = dispatchTextInputChangeEvent(1000001, 'second');

    expect(firstEvent?.nativeEvent.eventCount).toBe(1);
    expect(secondEvent?.nativeEvent.eventCount).toBe(2);
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('uses an explicit eventCount override when provided', () => {
    const onChange = mock(() => {});
    const onChangeText = mock(() => {});

    registerHostInstanceEventHandlers(1000001, {
      onChange,
      onChangeText,
    });

    const event = dispatchTextInputChangeEvent(1000001, 42, {
      eventCount: 9,
    });

    expect(event?.nativeEvent).toEqual({
      text: '42',
      eventCount: 9,
      target: 1000001,
      timestamp: event?.timeStamp,
    });
    expect(onChangeText).toHaveBeenCalledWith('42');
  });
});
