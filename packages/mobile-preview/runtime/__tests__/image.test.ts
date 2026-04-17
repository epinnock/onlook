import { beforeEach, describe, expect, it } from 'bun:test';

import { createHostConfig } from '../fabric-host-config.js';
import image from '../host/components/image.js';
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

describe('Image host component', () => {
  it('maps Image through filename-based component discovery', () => {
    const discoveredModules = {
      './image.js': {
        default: image,
      },
    };

    expect(primeAutoDiscoveredHostComponents(discoveredModules)).toEqual([
      'View',
      'Text',
      'RCTText',
      'RawText',
      'RCTRawText',
      'image',
    ]);

    expect(
      resolveHostComponent(
        'Image',
        {
          source: 'https://cdn.example.com/hero.png',
          resizeMode: 'contain',
        },
        { discoveredModules },
      ),
    ).toEqual({
      type: 'RCTImageView',
      props: {
        source: {
          uri: 'https://cdn.example.com/hero.png',
        },
        resizeMode: 'contain',
      },
      componentId: 'image',
    });
  });

  it('creates Fabric host instances with normalized image props', () => {
    primeAutoDiscoveredHostComponents({
      './image.js': {
        default: image,
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
      'Image',
      {
        source: {
          uri: 'data:image/png;base64,AAA=',
          width: 64,
          height: 64,
        },
        style: [{ width: 120 }, { height: 80 }],
        testID: 'hero-image',
      },
      null,
      null,
      { fiber: true },
    );

    expect(instance.type).toBe('RCTImageView');
    expect(instance.sourceType).toBe('Image');
    expect(instance.componentId).toBe('image');
    expect(createNodeCalls).toEqual([
      {
        tag: 1000000,
        type: 'RCTImageView',
        rootTag: 23,
        props: {
          source: {
            uri: 'data:image/png;base64,AAA=',
            width: 64,
            height: 64,
          },
          resizeMode: 'cover',
          width: 120,
          height: 80,
          testID: 'hero-image',
        },
        internalHandle: { fiber: true },
      },
    ]);
  });
});
