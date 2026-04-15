import { beforeEach, describe, expect, it } from 'bun:test';

import { createHostConfig } from '../fabric-host-config.js';
import * as scrollViewModule from '../host/components/scroll-view.js';
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

describe('scroll-view host component', () => {
  const discoveredModules = {
    './scroll-view.js': scrollViewModule,
  };

  it('maps ScrollView to RCTScrollView and preserves nested scroll props', () => {
    const onScroll = () => {};

    expect(
      resolveHostComponent(
        'ScrollView',
        {
          contentContainerStyle: { paddingVertical: 12 },
          onScroll,
          showsVerticalScrollIndicator: false,
          style: { flex: 1 },
          testID: 'feed',
        },
        { discoveredModules },
      ),
    ).toEqual({
      type: 'RCTScrollView',
      props: {
        contentContainerStyle: { paddingVertical: 12 },
        onScroll,
        scrollEventThrottle: 16,
        showsVerticalScrollIndicator: false,
        style: { flex: 1 },
        testID: 'feed',
        automaticallyAdjustContentInsets: false,
      },
      componentId: 'scroll-view',
    });
  });

  it('preserves explicit inset and throttle props', () => {
    expect(
      resolveHostComponent(
        'ScrollView',
        {
          automaticallyAdjustContentInsets: true,
          horizontal: true,
          scrollEventThrottle: 64,
          showsHorizontalScrollIndicator: false,
        },
        { discoveredModules },
      ),
    ).toEqual({
      type: 'RCTScrollView',
      props: {
        automaticallyAdjustContentInsets: true,
        horizontal: true,
        scrollEventThrottle: 64,
        showsHorizontalScrollIndicator: false,
      },
      componentId: 'scroll-view',
    });
  });

  it('uses the resolver when Fabric host instances are created', () => {
    const createNodeCalls = [];
    const onScroll = () => {};

    registerHostComponent(scrollViewModule, 'scroll-view');

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
      'ScrollView',
      {
        contentContainerStyle: { paddingHorizontal: 8 },
        onScroll,
        style: { backgroundColor: 0xff112233 },
        testID: 'feed',
      },
      null,
      null,
      { fiber: true },
    );

    expect(instance.type).toBe('RCTScrollView');
    expect(instance.sourceType).toBe('ScrollView');
    expect(instance.componentId).toBe('scroll-view');
    expect(instance.handlers).toEqual({ onScroll });
    expect(createNodeCalls).toEqual([
      {
        tag: 1000000,
        type: 'RCTScrollView',
        rootTag: 19,
        props: {
          backgroundColor: 0xff112233 | 0,
          contentContainerStyle: { paddingHorizontal: 8 },
          onScroll,
          scrollEventThrottle: 16,
          testID: 'feed',
          automaticallyAdjustContentInsets: false,
        },
        internalHandle: { fiber: true },
      },
    ]);
  });
});
