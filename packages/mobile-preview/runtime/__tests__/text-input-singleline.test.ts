import { beforeEach, describe, expect, it } from 'bun:test';

import {
  getHostComponentCandidateIds,
  resetHostComponentRegistry,
  resolveHostComponent,
} from '../host/components/index.js';
import {
  __resetTextInputControlStateForTests,
  recordTextInputNativeValue,
} from '../host/components/text-input-control.js';
import textInputSinglelineHostComponent from '../host/components/text-input-singleline.js';

beforeEach(() => {
  resetHostComponentRegistry();
  __resetTextInputControlStateForTests();
});

describe('text-input-singleline host component', () => {
  it('maps TextInput to the single-line native host type through the registry', () => {
    expect(
      resolveHostComponent(
        'TextInput',
        {
          defaultValue: 'hello',
          placeholder: 'Name',
        },
        {
          discoveredModules: {
            './text-input-singleline.js': {
              default: textInputSinglelineHostComponent,
            },
          },
        },
      ),
    ).toEqual({
      type: 'RCTSinglelineTextInputView',
      props: {
        defaultValue: 'hello',
        placeholder: 'Name',
      },
      componentId: 'text-input-singleline',
    });

    expect(getHostComponentCandidateIds('TextInput', {})).toEqual([
      'TextInput',
      'text-input-singleline',
      'text-input',
    ]);
  });

  it('removes multiline and applies controlled text-input props when a host tag is provided', () => {
    recordTextInputNativeValue(1000001, 'draft', {
      eventCount: 7,
    });

    expect(
      textInputSinglelineHostComponent.resolve(
        'TextInput',
        {
          multiline: false,
          value: 'server value',
          placeholder: 'Message',
        },
        {
          tag: 1000001,
        },
      ),
    ).toEqual({
      type: 'RCTSinglelineTextInputView',
      props: {
        text: 'server value',
        placeholder: 'Message',
        mostRecentEventCount: 7,
      },
    });
  });

  it('uses defaultValue for the first uncontrolled mount when the host tag is provided', () => {
    expect(
      textInputSinglelineHostComponent.resolve(
        'TextInput',
        {
          defaultValue: 'first value',
          placeholder: 'Title',
        },
        {
          tag: 1000002,
        },
      ),
    ).toEqual({
      type: 'RCTSinglelineTextInputView',
      props: {
        text: 'first value',
        placeholder: 'Title',
      },
    });
  });
});
