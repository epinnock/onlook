import { beforeEach, describe, expect, it } from 'bun:test';

import {
  __resetTextInputControlStateForTests,
  recordTextInputNativeValue,
  resolveControlledTextInputProps,
} from '../host/components/text-input-control.js';

beforeEach(() => {
  __resetTextInputControlStateForTests();
});

describe('resolveControlledTextInputProps', () => {
  it('maps a controlled value prop to native text and mostRecentEventCount', () => {
    recordTextInputNativeValue(1000001, 'draft', { eventCount: 3 });

    expect(
      resolveControlledTextInputProps(1000001, {
        value: 'server value',
        placeholder: 'Name',
      }),
    ).toEqual({
      text: 'server value',
      placeholder: 'Name',
      mostRecentEventCount: 3,
    });
  });

  it('uses defaultValue only on the first uncontrolled mount', () => {
    expect(
      resolveControlledTextInputProps(1000001, {
        defaultValue: 'hello',
        placeholder: 'Message',
      }),
    ).toEqual({
      text: 'hello',
      placeholder: 'Message',
    });

    recordTextInputNativeValue(1000001, 'edited locally');

    expect(
      resolveControlledTextInputProps(1000001, {
        defaultValue: 'hello',
        placeholder: 'Message',
      }),
    ).toEqual({
      text: 'edited locally',
      placeholder: 'Message',
    });
  });

  it('preserves explicit text on first mount when value is not controlled', () => {
    expect(
      resolveControlledTextInputProps(1000001, {
        text: 'native text',
        multiline: true,
      }),
    ).toEqual({
      text: 'native text',
      multiline: true,
    });
  });
});

describe('recordTextInputNativeValue', () => {
  it('tracks the latest native text and increments eventCount when omitted', () => {
    expect(recordTextInputNativeValue(1000001, 'one')).toEqual({
      text: 'one',
      eventCount: 1,
    });

    expect(recordTextInputNativeValue(1000001, 'two')).toEqual({
      text: 'two',
      eventCount: 2,
    });
  });

  it('accepts explicit eventCount values from native text change dispatch', () => {
    expect(
      recordTextInputNativeValue(1000001, 42, {
        eventCount: 9,
      }),
    ).toEqual({
      text: '42',
      eventCount: 9,
    });

    expect(
      resolveControlledTextInputProps(1000001, {
        value: 'controlled',
        testID: 'field',
      }),
    ).toEqual({
      text: 'controlled',
      testID: 'field',
      mostRecentEventCount: 9,
    });
  });
});
