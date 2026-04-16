import { beforeEach, describe, expect, it } from 'bun:test';

import { createHostConfig } from '../fabric-host-config.js';
import * as textInputMultilineModule from '../host/components/text-input-multiline.js';
import { recordTextInputNativeValue } from '../host/components/text-input-control.js';
import {
  registerHostComponent,
  resetHostComponentRegistry,
  resolveHostComponent,
} from '../host/components/index.js';
import { resetHostTagCounter } from '../host/tags.js';

beforeEach(() => {
  resetHostTagCounter();
  resetHostComponentRegistry();
});

describe('text-input-multiline host component', () => {
  const discoveredModules = {
    './text-input-multiline.js': textInputMultilineModule,
  };

  it('maps multiline TextInput to RCTMultilineTextInputView and enables multiline mode', () => {
    expect(
      resolveHostComponent(
        'TextInput',
        {
          multiline: true,
          numberOfLines: 4,
          placeholder: 'Write a reply',
          testID: 'composer',
        },
        { discoveredModules },
      ),
    ).toEqual({
      type: 'RCTMultilineTextInputView',
      props: {
        multiline: true,
        numberOfLines: 4,
        placeholder: 'Write a reply',
        testID: 'composer',
      },
      componentId: 'text-input-multiline',
    });
  });

  it('reuses controlled text input state via a stable multiline control key', () => {
    const controlTag = textInputMultilineModule.__getTextInputMultilineControlTagForTests({
      nativeID: 'comment-box',
    });

    expect(controlTag).toBeNumber();

    recordTextInputNativeValue(controlTag, 'draft reply', {
      eventCount: 7,
    });

    expect(
      resolveHostComponent(
        'TextInput',
        {
          multiline: true,
          nativeID: 'comment-box',
          value: 'server reply',
        },
        { discoveredModules },
      ),
    ).toEqual({
      type: 'RCTMultilineTextInputView',
      props: {
        multiline: true,
        nativeID: 'comment-box',
        text: 'server reply',
        mostRecentEventCount: 7,
      },
      componentId: 'text-input-multiline',
    });
  });

  it('uses the multiline resolver when Fabric host instances are created', () => {
    const createNodeCalls = [];

    registerHostComponent(textInputMultilineModule, 'text-input-multiline');

    const controlTag = textInputMultilineModule.__getTextInputMultilineControlTagForTests({
      testID: 'feedback-field',
    });

    recordTextInputNativeValue(controlTag, 'edited locally', {
      eventCount: 2,
    });

    const fab = {
      createNode(tag, type, rootTag, props, internalHandle) {
        createNodeCalls.push({ tag, type, rootTag, props, internalHandle });
        return { tag, type, props };
      },
      cloneNodeWithNewProps(node, props) {
        return { ...node, props };
      },
      appendChild() {},
      createChildSet() {
        return [];
      },
      appendChildToSet() {},
      completeRoot() {},
    };

    const hostConfig = createHostConfig(fab, 19);
    const instance = hostConfig.createInstance(
      'TextInput',
      {
        multiline: true,
        style: { minHeight: 120, backgroundColor: 0xff112233 },
        testID: 'feedback-field',
        value: 'controlled value',
      },
      null,
      null,
      { fiber: true },
    );

    expect(instance.type).toBe('RCTMultilineTextInputView');
    expect(instance.sourceType).toBe('TextInput');
    expect(instance.componentId).toBe('text-input-multiline');
    expect(createNodeCalls).toEqual([
      {
        tag: 1000000,
        type: 'RCTMultilineTextInputView',
        rootTag: 19,
        props: {
          multiline: true,
          minHeight: 120,
          backgroundColor: 0xff112233 | 0,
          testID: 'feedback-field',
          text: 'controlled value',
          mostRecentEventCount: 2,
        },
        internalHandle: { fiber: true },
      },
    ]);
  });
});
