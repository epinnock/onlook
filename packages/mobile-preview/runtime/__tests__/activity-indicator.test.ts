import { beforeEach, describe, expect, it } from 'bun:test';

import { createHostConfig } from '../fabric-host-config.js';
import activityIndicator from '../host/components/activity-indicator.js';
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

describe('ActivityIndicator host component', () => {
  it('maps ActivityIndicator through filename-based component discovery', () => {
    const discoveredModules = {
      './activity-indicator.js': {
        default: activityIndicator,
      },
    };

    expect(primeAutoDiscoveredHostComponents(discoveredModules)).toEqual([
      'View',
      'Text',
      'RCTText',
      'RawText',
      'RCTRawText',
      'activity-indicator',
    ]);

    expect(
      resolveHostComponent(
        'ActivityIndicator',
        {
          color: 0xff00aa44,
          size: 'large',
        },
        { discoveredModules },
      ),
    ).toEqual({
      type: 'RCTActivityIndicatorView',
      props: {
        color: 0xff00aa44,
        size: 'large',
        animating: true,
      },
      componentId: 'activity-indicator',
    });
  });

  it('creates Fabric host instances with normalized spinner props', () => {
    primeAutoDiscoveredHostComponents({
      './activity-indicator.js': {
        default: activityIndicator,
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
      'ActivityIndicator',
      {
        animating: false,
        color: 0xff112233,
        size: 24,
        style: [{ marginTop: 12 }, { opacity: 0.75 }],
        testID: 'spinner',
      },
      null,
      null,
      { fiber: true },
    );

    expect(instance.type).toBe('RCTActivityIndicatorView');
    expect(instance.sourceType).toBe('ActivityIndicator');
    expect(instance.componentId).toBe('activity-indicator');
    expect(createNodeCalls).toEqual([
      {
        tag: 1000000,
        type: 'RCTActivityIndicatorView',
        rootTag: 23,
        props: {
          animating: false,
          color: 0xff112233,
          size: 24,
          marginTop: 12,
          opacity: 0.75,
          testID: 'spinner',
        },
        internalHandle: { fiber: true },
      },
    ]);
  });
});
