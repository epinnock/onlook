import { beforeEach, describe, expect, it } from 'bun:test';

import { createHostConfig } from '../fabric-host-config.js';
import switchComponent from '../host/components/switch.js';
import {
  primeAutoDiscoveredHostComponents,
  resetHostComponentRegistry,
  resolveHostComponent,
} from '../host/components/index.js';
import { resetHostTagCounter } from '../host/tags.js';

beforeEach(() => {
  resetHostTagCounter();
  resetHostComponentRegistry();
});

describe('Switch host component', () => {
  it('maps Switch through filename-based component discovery', () => {
    const discoveredModules = {
      './switch.js': {
        default: switchComponent,
      },
    };

    expect(primeAutoDiscoveredHostComponents(discoveredModules)).toEqual([
      'View',
      'Text',
      'RCTText',
      'RawText',
      'RCTRawText',
      'switch',
    ]);

    expect(
      resolveHostComponent(
        'Switch',
        {
          value: 1,
          disabled: 0,
          thumbColor: '#ffffff',
          trackColor: {
            false: '#4b5563',
            true: '#22c55e',
          },
        },
        { discoveredModules },
      ),
    ).toEqual({
      type: 'RCTSwitch',
      props: {
        value: true,
        disabled: false,
        thumbTintColor: '#ffffff',
        tintColor: '#4b5563',
        onTintColor: '#22c55e',
      },
      componentId: 'switch',
    });
  });

  it('creates Fabric host instances with normalized switch props', () => {
    primeAutoDiscoveredHostComponents({
      './switch.js': {
        default: switchComponent,
      },
    });

    const createNodeCalls: Array<{
      tag: number;
      type: string;
      rootTag: number;
      props: Record<string, unknown>;
      internalHandle: unknown;
    }> = [];

    const fab = {
      createNode(
        tag: number,
        type: string,
        rootTag: number,
        props: Record<string, unknown>,
        internalHandle: unknown,
      ) {
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

    const hostConfig = createHostConfig(fab, 23);
    const instance = hostConfig.createInstance(
      'Switch',
      {
        value: '',
        disabled: 'yes',
        ios_backgroundColor: '#9ca3af',
        trackColor: {
          true: '#2563eb',
        },
        thumbColor: '#f8fafc',
        style: [{ marginTop: 12 }, { opacity: 0.75 }],
        testID: 'preview-switch',
      },
      null,
      null,
      { fiber: true },
    );

    expect(instance.type).toBe('RCTSwitch');
    expect(instance.sourceType).toBe('Switch');
    expect(instance.componentId).toBe('switch');
    expect(createNodeCalls).toEqual([
      {
        tag: 1000000,
        type: 'RCTSwitch',
        rootTag: 23,
        props: {
          value: false,
          disabled: true,
          tintColor: '#9ca3af',
          onTintColor: '#2563eb',
          thumbTintColor: '#f8fafc',
          marginTop: 12,
          opacity: 0.75,
          testID: 'preview-switch',
        },
        internalHandle: { fiber: true },
      },
    ]);
  });
});
