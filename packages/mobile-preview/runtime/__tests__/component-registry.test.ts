import { beforeEach, describe, expect, it } from 'bun:test';

import { createHostConfig } from '../fabric-host-config.js';
import {
  getHostComponentCandidateIds,
  getRegisteredHostComponentIds,
  primeAutoDiscoveredHostComponents,
  registerHostComponent,
  resetHostComponentRegistry,
  resolveHostComponent,
} from '../host/components/index.js';
import { resetHostTagCounter } from '../host/tags.js';

beforeEach(() => {
  resetHostTagCounter();
  resetHostComponentRegistry();
});

describe('host component registry', () => {
  it('primes built-in aliases and discovers component modules by filename', () => {
    const discoveredModules = {
      './index.js': {
        default: {
          ignored: true,
        },
      },
      './scroll-view.js': {
        default: {
          nativeType: 'RCTScrollView',
          mapProps(props: Record<string, unknown>) {
            return {
              ...props,
              automaticallyAdjustContentInsets: false,
            };
          },
        },
      },
      './text-input-multiline.js': {
        default: {
          nativeType: 'RCTMultilineTextInputView',
        },
      },
    };

    expect(primeAutoDiscoveredHostComponents(discoveredModules)).toEqual([
      'View',
      'Text',
      'RCTText',
      'RawText',
      'RCTRawText',
      'scroll-view',
      'text-input-multiline',
    ]);

    expect(resolveHostComponent('Text', { selectable: true }, { discoveredModules })).toEqual({
      type: 'RCTText',
      props: { selectable: true },
      componentId: 'Text',
    });

    expect(resolveHostComponent('ScrollView', { horizontal: true }, { discoveredModules })).toEqual({
      type: 'RCTScrollView',
      props: {
        horizontal: true,
        automaticallyAdjustContentInsets: false,
      },
      componentId: 'scroll-view',
    });

    expect(
      resolveHostComponent('TextInput', { multiline: true, testID: 'field' }, { discoveredModules }),
    ).toEqual({
      type: 'RCTMultilineTextInputView',
      props: {
        multiline: true,
        testID: 'field',
      },
      componentId: 'text-input-multiline',
    });

    expect(getHostComponentCandidateIds('TextInput', { multiline: true })).toEqual([
      'TextInput',
      'text-input-multiline',
      'text-input',
    ]);
    expect(getRegisteredHostComponentIds()).toEqual([
      'View',
      'Text',
      'RCTText',
      'RawText',
      'RCTRawText',
      'scroll-view',
      'text-input-multiline',
    ]);
  });

  it('uses registered mappings when Fabric host instances are created', () => {
    const createNodeCalls: Array<{
      tag: number;
      type: string;
      rootTag: number;
      props: Record<string, unknown>;
      internalHandle: unknown;
    }> = [];

    registerHostComponent(
      {
        id: 'ScrollView',
        nativeType: 'RCTScrollView',
        mapProps(props: Record<string, unknown>) {
          return {
            ...props,
            alwaysBounceVertical: false,
          };
        },
      },
      './scroll-view.js',
    );

    const fab = {
      createNode(tag: number, type: string, rootTag: number, props: Record<string, unknown>, internalHandle: unknown) {
        createNodeCalls.push({ tag, type, rootTag, props, internalHandle });
        return { tag, type, props };
      },
      cloneNodeWithNewProps(node: Record<string, unknown>, props: Record<string, unknown>) {
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
      'ScrollView',
      {
        style: {
          backgroundColor: 0xff112233,
        },
        testID: 'feed',
      },
      null,
      null,
      { fiber: true },
    );

    expect(instance.type).toBe('RCTScrollView');
    expect(instance.sourceType).toBe('ScrollView');
    expect(instance.componentId).toBe('ScrollView');
    expect(createNodeCalls).toEqual([
      {
        tag: 1000000,
        type: 'RCTScrollView',
        rootTag: 19,
        props: {
          backgroundColor: 0xff112233 | 0,
          testID: 'feed',
          alwaysBounceVertical: false,
        },
        internalHandle: { fiber: true },
      },
    ]);
  });
});
