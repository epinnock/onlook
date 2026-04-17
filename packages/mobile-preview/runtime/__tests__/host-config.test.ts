import { afterEach, beforeEach, describe, expect, it } from 'bun:test';

import { createHostConfig } from '../fabric-host-config.js';
import { resetHostTagCounter } from '../host/tags.js';

describe('createHostConfig', () => {
  const originalLog = globalThis._log;

  beforeEach(() => {
    resetHostTagCounter();
    globalThis._log = undefined;
  });

  afterEach(() => {
    globalThis._log = originalLog;
  });

  it('preserves prop flattening and update cloning through the facade', () => {
    const createNodeCalls = [];
    const cloneNodeCalls = [];

    const fab = {
      createNode(tag, type, rootTag, props, internalHandle) {
        createNodeCalls.push({ tag, type, rootTag, props, internalHandle });
        return { kind: 'node', tag, type, props };
      },

      cloneNodeWithNewProps(node, props) {
        cloneNodeCalls.push({ node, props });
        return { ...node, props };
      },

      appendChild() {},
      createChildSet() {
        return [];
      },
      appendChildToSet() {},
      completeRoot() {},
    };

    const hostConfig = createHostConfig(fab, 41);
    const instance = hostConfig.createInstance(
      'View',
      {
        style: [
          { backgroundColor: 0xff112233, color: 0xaa00aa00 },
          { padding: 12, borderColor: 0xff00ff00 },
        ],
        accessibilityLabel: 'hero',
        children: 'ignored',
        ref: 'ignored',
        key: 'ignored',
      },
      null,
      null,
      { fiber: true },
    );

    expect(instance.tag).toBe(1000000);
    expect(createNodeCalls[0]).toEqual({
      tag: 1000000,
      type: 'View',
      rootTag: 41,
      props: {
        backgroundColor: 0xff112233 | 0,
        color: 0xaa00aa00 | 0,
        padding: 12,
        borderColor: 0xff00ff00 | 0,
        accessibilityLabel: 'hero',
      },
      internalHandle: { fiber: true },
    });

    const updatePayload = hostConfig.prepareUpdate(
      instance,
      'View',
      {
        style: { padding: 4 },
        testID: 'before',
      },
      {
        style: [{ padding: 8 }, { borderColor: 0xff445566 }],
        testID: 'after',
      },
    );

    expect(updatePayload).toEqual({
      style: [{ padding: 8 }, { borderColor: 0xff445566 }],
      testID: 'after',
    });

    hostConfig.commitUpdate(instance, updatePayload, 'View', {}, {}, null);

    expect(cloneNodeCalls).toEqual([
      {
        node: {
          kind: 'node',
          tag: 1000000,
          type: 'View',
          props: {
            backgroundColor: 0xff112233 | 0,
            color: 0xaa00aa00 | 0,
            padding: 12,
            borderColor: 0xff00ff00 | 0,
            accessibilityLabel: 'hero',
          },
        },
        props: {
          padding: 8,
          borderColor: 0xff445566,
          testID: 'after',
        },
      },
    ]);
  });

  it('preserves container ordering and completeRoot commits', () => {
    const logs = [];
    const childSets = [];
    const completeRootCalls = [];

    globalThis._log = (message) => {
      logs.push(message);
    };

    const fab = {
      createNode(tag, type, rootTag, props) {
        return { kind: 'node', tag, type, rootTag, props };
      },

      cloneNodeWithNewProps(node, props) {
        return { ...node, props };
      },

      appendChild() {},

      createChildSet(rootTag) {
        const childSet = { rootTag, nodes: [] };
        childSets.push(childSet);
        return childSet;
      },

      appendChildToSet(childSet, node) {
        childSet.nodes.push(node);
      },

      completeRoot(rootTag, childSet) {
        completeRootCalls.push({ rootTag, childSet });
      },
    };

    const hostConfig = createHostConfig(fab, 7);
    const first = hostConfig.createTextInstance('first', null, null, null);
    const second = hostConfig.createTextInstance('second', null, null, null);
    const container = { children: [] };

    hostConfig.appendChildToContainer(container, first);
    hostConfig.insertInContainerBefore(container, second, first);
    expect(container.children.map((child) => child.tag)).toEqual([second.tag, first.tag]);

    hostConfig.removeChildFromContainer(container, second);
    expect(container.children.map((child) => child.tag)).toEqual([first.tag]);

    hostConfig.resetAfterCommit(container);

    expect(childSets).toEqual([
      {
        rootTag: 7,
        nodes: [first.node],
      },
    ]);
    expect(completeRootCalls).toEqual([
      {
        rootTag: 7,
        childSet: childSets[0],
      },
    ]);
    expect(logs).toContain('HOST appendChildToContainer tag=1000000 total=1');
    expect(logs).toContain('HOST removeChildFromContainer total=1');
    expect(logs).toContain('HOST completeRoot rootTag=7 count=1');
    expect(logs).toContain('HOST completeRoot DONE');
  });
});
