export const MODAL_SURFACE_COMPONENT_ID = 'modal-surface';
export const MODAL_SURFACE_NATIVE_TYPE = 'RCTModalHostView';
export const SECONDARY_ROOT_TAG_STEP = 10;

export function normalizeModalSurfaceProps(props = {}) {
  return {
    ...props,
    animationType: props.animationType ?? 'none',
    presentationStyle: props.presentationStyle ?? 'fullScreen',
    transparent: props.transparent ?? false,
    visible: props.visible ?? true,
  };
}

export function createSecondaryRootTagAllocator(step = SECONDARY_ROOT_TAG_STEP) {
  return function allocateSecondaryRootTag(rootTag, surfaceIndex) {
    return rootTag + (surfaceIndex + 1) * step;
  };
}

export function isModalSurfaceInstance(instance) {
  return instance?.componentId === MODAL_SURFACE_COMPONENT_ID;
}

export function collectModalSurfaceInstances(children = []) {
  const modalInstances = [];

  walkHostChildren(children, (instance) => {
    if (isModalSurfaceInstance(instance)) {
      modalInstances.push(instance);
    }
  });

  return modalInstances;
}

function walkHostChildren(children, visit) {
  for (const child of children) {
    if (!child || typeof child !== 'object') {
      continue;
    }

    visit(child);

    if (Array.isArray(child.children) && child.children.length > 0) {
      walkHostChildren(child.children, visit);
    }
  }
}

function appendChildNodesToSet(fab, childSet, children = []) {
  let childCount = 0;

  for (const child of children) {
    if (!child || typeof child !== 'object' || !('node' in child)) {
      continue;
    }

    fab.appendChildToSet(childSet, child.node);
    childCount++;
  }

  return childCount;
}

function toSurfaceSnapshot(surface) {
  return {
    modalTag: surface.modalTag,
    rootTag: surface.rootTag,
    visible: surface.visible,
    mounted: surface.mounted,
    childCount: surface.childCount,
  };
}

export function createModalSurfaceManager(
  fab,
  rootTag,
  { allocateRootTag = createSecondaryRootTagAllocator() } = {},
) {
  const surfaces = new Map();
  let nextSurfaceIndex = 0;

  function ensureSurface(modalInstance) {
    let surface = surfaces.get(modalInstance.tag);

    if (!surface) {
      surface = {
        modalTag: modalInstance.tag,
        rootTag: allocateRootTag(rootTag, nextSurfaceIndex++, modalInstance.tag),
        visible: false,
        mounted: false,
        childCount: 0,
      };
      surfaces.set(modalInstance.tag, surface);
    }

    return surface;
  }

  function commitSurface(modalInstance) {
    const surface = ensureSurface(modalInstance);
    const childSet = fab.createChildSet(surface.rootTag);

    surface.childCount = appendChildNodesToSet(fab, childSet, modalInstance.children);
    fab.completeRoot(surface.rootTag, childSet);
    surface.visible = true;
    surface.mounted = true;

    return toSurfaceSnapshot(surface);
  }

  function clearSurface(modalTag) {
    const surface = surfaces.get(modalTag);

    if (!surface || !surface.mounted) {
      return null;
    }

    const childSet = fab.createChildSet(surface.rootTag);
    fab.completeRoot(surface.rootTag, childSet);
    surface.visible = false;
    surface.mounted = false;
    surface.childCount = 0;

    return toSurfaceSnapshot(surface);
  }

  function sync(children = []) {
    const activeModalTags = new Set();
    const committedSurfaces = [];

    for (const modalInstance of collectModalSurfaceInstances(children)) {
      const surface = ensureSurface(modalInstance);
      const props = normalizeModalSurfaceProps(modalInstance.props);

      activeModalTags.add(surface.modalTag);

      if (props.visible) {
        committedSurfaces.push(commitSurface(modalInstance));
        continue;
      }

      clearSurface(surface.modalTag);
    }

    for (const [modalTag] of surfaces) {
      if (activeModalTags.has(modalTag)) {
        continue;
      }

      clearSurface(modalTag);
      surfaces.delete(modalTag);
    }

    return committedSurfaces;
  }

  function getSurface(modalTag) {
    const surface = surfaces.get(modalTag);
    return surface ? toSurfaceSnapshot(surface) : null;
  }

  function getSurfaces() {
    return Array.from(surfaces.values(), toSurfaceSnapshot);
  }

  function dispose() {
    const clearedSurfaces = [];

    for (const [modalTag] of Array.from(surfaces.entries())) {
      const clearedSurface = clearSurface(modalTag);
      if (clearedSurface) {
        clearedSurfaces.push(clearedSurface);
      }

      surfaces.delete(modalTag);
    }

    return clearedSurfaces;
  }

  return {
    clearSurface,
    commitSurface,
    dispose,
    getSurface,
    getSurfaces,
    sync,
  };
}

export default {
  id: MODAL_SURFACE_COMPONENT_ID,
  nativeType: MODAL_SURFACE_NATIVE_TYPE,
  mapProps: normalizeModalSurfaceProps,
};
