import { beforeEach, describe, expect, it } from 'bun:test';

import {
  primeAutoDiscoveredHostComponents,
  resetHostComponentRegistry,
  resolveHostComponent,
} from '../host/components/index.js';
import { installAppRegistry } from '../bootstrap/app-registry.js';
import modalSurface, {
  createModalSurfaceManager,
} from '../host/modal-surface.js';

beforeEach(() => {
  resetHostComponentRegistry();
});

function createHostChild(tag: number) {
  return {
    tag,
    node: { tag },
    type: 'RCTRawText',
    children: [],
  };
}

function createModalInstance(
  tag: number,
  props: Record<string, unknown>,
  children: Array<Record<string, unknown>>,
) {
  return {
    tag,
    componentId: 'modal-surface',
    type: 'RCTModalHostView',
    props,
    children,
  };
}

describe('modal surface host component', () => {
  it('maps Modal through discovery and normalizes host props', () => {
    const discoveredModules = {
      './modal-surface.js': {
        default: modalSurface,
      },
    };

    expect(primeAutoDiscoveredHostComponents(discoveredModules)).toEqual([
      'View',
      'Text',
      'RCTText',
      'RawText',
      'RCTRawText',
      'modal-surface',
    ]);

    expect(
      resolveHostComponent(
        'Modal',
        {
          testID: 'sheet',
          transparent: true,
        },
        { discoveredModules },
      ),
    ).toEqual({
      type: 'RCTModalHostView',
      props: {
        animationType: 'none',
        presentationStyle: 'fullScreen',
        testID: 'sheet',
        transparent: true,
        visible: true,
      },
      componentId: 'modal-surface',
    });
  });

  it('commits visible modal children to stable secondary Fabric roots', () => {
    const childSets: Array<{ rootTag: number; nodes: Array<{ tag: number }> }> = [];
    const completeRootCalls: Array<{ rootTag: number; childSet: { rootTag: number; nodes: Array<{ tag: number }> } }> =
      [];

    const fab = {
      createChildSet(rootTag: number) {
        const childSet = { rootTag, nodes: [] as Array<{ tag: number }> };
        childSets.push(childSet);
        return childSet;
      },
      appendChildToSet(
        childSet: { rootTag: number; nodes: Array<{ tag: number }> },
        node: { tag: number },
      ) {
        childSet.nodes.push(node);
      },
      completeRoot(
        rootTag: number,
        childSet: { rootTag: number; nodes: Array<{ tag: number }> },
      ) {
        completeRootCalls.push({ rootTag, childSet });
      },
    };

    const manager = createModalSurfaceManager(fab, 7);
    const firstModal = createModalInstance(201, { visible: true }, [createHostChild(11)]);
    const secondModal = createModalInstance(202, { visible: true }, [createHostChild(12)]);
    const wrapper = {
      tag: 99,
      node: { tag: 99 },
      type: 'View',
      children: [firstModal],
    };

    expect(manager.sync([wrapper, secondModal])).toEqual([
      {
        modalTag: 201,
        rootTag: 17,
        visible: true,
        mounted: true,
        childCount: 1,
      },
      {
        modalTag: 202,
        rootTag: 27,
        visible: true,
        mounted: true,
        childCount: 1,
      },
    ]);

    expect(completeRootCalls).toEqual([
      {
        rootTag: 17,
        childSet: childSets[0],
      },
      {
        rootTag: 27,
        childSet: childSets[1],
      },
    ]);
    expect(childSets).toEqual([
      {
        rootTag: 17,
        nodes: [{ tag: 11 }],
      },
      {
        rootTag: 27,
        nodes: [{ tag: 12 }],
      },
    ]);
    expect(manager.getSurfaces()).toEqual([
      {
        modalTag: 201,
        rootTag: 17,
        visible: true,
        mounted: true,
        childCount: 1,
      },
      {
        modalTag: 202,
        rootTag: 27,
        visible: true,
        mounted: true,
        childCount: 1,
      },
    ]);
  });

  it('clears hidden or removed modal surfaces without changing their assigned root tag', () => {
    const childSets: Array<{ rootTag: number; nodes: Array<{ tag: number }> }> = [];
    const completeRootCalls: Array<{ rootTag: number; childSet: { rootTag: number; nodes: Array<{ tag: number }> } }> =
      [];

    const fab = {
      createChildSet(rootTag: number) {
        const childSet = { rootTag, nodes: [] as Array<{ tag: number }> };
        childSets.push(childSet);
        return childSet;
      },
      appendChildToSet(
        childSet: { rootTag: number; nodes: Array<{ tag: number }> },
        node: { tag: number },
      ) {
        childSet.nodes.push(node);
      },
      completeRoot(
        rootTag: number,
        childSet: { rootTag: number; nodes: Array<{ tag: number }> },
      ) {
        completeRootCalls.push({ rootTag, childSet });
      },
    };

    const manager = createModalSurfaceManager(fab, 5);
    const modal = createModalInstance(301, { visible: true }, [createHostChild(21)]);

    expect(manager.sync([modal])).toEqual([
      {
        modalTag: 301,
        rootTag: 15,
        visible: true,
        mounted: true,
        childCount: 1,
      },
    ]);

    modal.props = { visible: false };
    modal.children = [createHostChild(22)];

    expect(manager.sync([modal])).toEqual([]);
    expect(manager.getSurface(301)).toEqual({
      modalTag: 301,
      rootTag: 15,
      visible: false,
      mounted: false,
      childCount: 0,
    });

    modal.props = { visible: true };

    expect(manager.sync([modal])).toEqual([
      {
        modalTag: 301,
        rootTag: 15,
        visible: true,
        mounted: true,
        childCount: 1,
      },
    ]);

    expect(manager.sync([])).toEqual([]);
    expect(manager.getSurface(301)).toBeNull();
    expect(completeRootCalls.map((call) => call.rootTag)).toEqual([15, 15, 15, 15]);
    expect(childSets).toEqual([
      {
        rootTag: 15,
        nodes: [{ tag: 21 }],
      },
      {
        rootTag: 15,
        nodes: [],
      },
      {
        rootTag: 15,
        nodes: [{ tag: 22 }],
      },
      {
        rootTag: 15,
        nodes: [],
      },
    ]);
  });

  it('disposes mounted surfaces and clears their secondary roots', () => {
    const childSets: Array<{ rootTag: number; nodes: Array<{ tag: number }> }> = [];
    const completeRootCalls: Array<{ rootTag: number; childSet: { rootTag: number; nodes: Array<{ tag: number }> } }> =
      [];

    const fab = {
      createChildSet(rootTag: number) {
        const childSet = { rootTag, nodes: [] as Array<{ tag: number }> };
        childSets.push(childSet);
        return childSet;
      },
      appendChildToSet(
        childSet: { rootTag: number; nodes: Array<{ tag: number }> },
        node: { tag: number },
      ) {
        childSet.nodes.push(node);
      },
      completeRoot(
        rootTag: number,
        childSet: { rootTag: number; nodes: Array<{ tag: number }> },
      ) {
        completeRootCalls.push({ rootTag, childSet });
      },
    };

    const manager = createModalSurfaceManager(fab, 9);

    expect(
      manager.sync([
        createModalInstance(401, { visible: true }, [createHostChild(31)]),
        createModalInstance(402, { visible: true }, [createHostChild(32)]),
      ]),
    ).toEqual([
      {
        modalTag: 401,
        rootTag: 19,
        visible: true,
        mounted: true,
        childCount: 1,
      },
      {
        modalTag: 402,
        rootTag: 29,
        visible: true,
        mounted: true,
        childCount: 1,
      },
    ]);

    expect(manager.dispose()).toEqual([
      {
        modalTag: 401,
        rootTag: 19,
        visible: false,
        mounted: false,
        childCount: 0,
      },
      {
        modalTag: 402,
        rootTag: 29,
        visible: false,
        mounted: false,
        childCount: 0,
      },
    ]);
    expect(manager.getSurfaces()).toEqual([]);
    expect(completeRootCalls.map((call) => call.rootTag)).toEqual([19, 29, 19, 29]);
    expect(childSets).toEqual([
      {
        rootTag: 19,
        nodes: [{ tag: 31 }],
      },
      {
        rootTag: 29,
        nodes: [{ tag: 32 }],
      },
      {
        rootTag: 19,
        nodes: [],
      },
      {
        rootTag: 29,
        nodes: [],
      },
    ]);
  });

  it('wires modal surface second-root support through AppRegistry lifecycle helpers', () => {
    const childSets: Array<{ rootTag: number; nodes: Array<{ tag: number }> }> = [];
    const completeRootCalls: Array<{ rootTag: number; childSet: { rootTag: number; nodes: Array<{ tag: number }> } }> =
      [];
    const reconcilerCalls: Array<{ fab: unknown; rootTag: number }> = [];
    const renderedElements: unknown[] = [];
    const logs: string[] = [];

    const fab = {
      createChildSet(rootTag: number) {
        const childSet = { rootTag, nodes: [] as Array<{ tag: number }> };
        childSets.push(childSet);
        return childSet;
      },
      appendChildToSet(
        childSet: { rootTag: number; nodes: Array<{ tag: number }> },
        node: { tag: number },
      ) {
        childSet.nodes.push(node);
      },
      completeRoot(
        rootTag: number,
        childSet: { rootTag: number; nodes: Array<{ tag: number }> },
      ) {
        completeRootCalls.push({ rootTag, childSet });
      },
    };

    const target = {
      React: {
        createElement(type: string, props?: Record<string, unknown>, ...children: unknown[]) {
          return {
            type,
            props: props ?? {},
            children,
          };
        },
      },
      _initReconciler(fabArg: unknown, rootTag: number) {
        reconcilerCalls.push({ fab: fabArg, rootTag });
      },
      fab,
      renderApp(element: unknown) {
        renderedElements.push(element);
      },
    };

    installAppRegistry(target, (message: string) => {
      logs.push(message);
    });

    target.RN$AppRegistry.runApplication('App', { rootTag: 13 });

    expect(target.currentRootTag).toBe(13);
    expect(reconcilerCalls).toEqual([{ fab, rootTag: 13 }]);
    expect(renderedElements).toHaveLength(1);
    expect(target.RN$AppRegistry.getModalSurfaces()).toEqual([]);

    const modal = createModalInstance(501, { visible: true }, [createHostChild(41)]);
    expect(target.RN$AppRegistry.syncModalSurfaces([modal])).toEqual([
      {
        modalTag: 501,
        rootTag: 23,
        visible: true,
        mounted: true,
        childCount: 1,
      },
    ]);
    expect(target.RN$AppRegistry.getModalSurfaces()).toEqual([
      {
        modalTag: 501,
        rootTag: 23,
        visible: true,
        mounted: true,
        childCount: 1,
      },
    ]);
    expect(target.RN$AppRegistry.unmountApplicationComponentAtRootTag(99)).toEqual(
      [],
    );
    expect(target.RN$AppRegistry.unmountApplicationComponentAtRootTag(13)).toEqual([
      {
        modalTag: 501,
        rootTag: 23,
        visible: false,
        mounted: false,
        childCount: 0,
      },
    ]);
    expect(target.currentRootTag).toBeNull();
    expect(target.RN$AppRegistry.getModalSurfaces()).toEqual([]);
    expect(logs).toEqual(
      expect.arrayContaining([
        'modal surface manager initialized',
        'modal surfaces synced=1',
        'modal surfaces cleared=1',
      ]),
    );
    expect(completeRootCalls.map((call) => call.rootTag)).toEqual([23, 23]);
    expect(childSets).toEqual([
      {
        rootTag: 23,
        nodes: [{ tag: 41 }],
      },
      {
        rootTag: 23,
        nodes: [],
      },
    ]);
  });
});
