/**
 * fabric-host-config.js — Maps react-reconciler to nativeFabricUIManager.
 *
 * This is a minimal host config that lets React's reconciler drive
 * Fabric's tree-mutation API. Only implements what's needed for
 * static rendering (no events, no state updates from native side).
 */

let nextTag = 1000000;
function allocTag() { return nextTag++; }

// Color helper: convert 0xAARRGGBB to signed int
function processColor(color) {
  if (typeof color === 'number') return color | 0;
  return color;
}

export function createHostConfig(fab, rootTag) {
  return {
    // --- Required: instance creation ---
    createInstance(type, props, rootContainerInstance, hostContext, internalHandle) {
      const tag = allocTag();
      // Flatten style into top-level props (Fabric expects flat props)
      let flatProps = {};
      for (const key in props) {
        if (key === 'children' || key === 'ref' || key === 'key') continue;
        if (key === 'style') {
          const s = props.style;
          if (s) {
            // Handle array styles
            const styles = Array.isArray(s) ? Object.assign({}, ...s) : s;
            for (const sk in styles) {
              let val = styles[sk];
              if (sk === 'backgroundColor' || sk === 'color' || sk === 'borderColor') {
                val = processColor(val);
              }
              flatProps[sk] = val;
            }
          }
        } else {
          flatProps[key] = props[key];
        }
      }

      const node = fab.createNode(tag, type, rootTag, flatProps, internalHandle);
      return { node, tag, type, children: [] };
    },

    createTextInstance(text, rootContainerInstance, hostContext, internalHandle) {
      const tag = allocTag();
      const node = fab.createNode(tag, 'RCTRawText', rootTag, { text: String(text) }, internalHandle);
      return { node, tag, type: 'RCTRawText', children: [], text };
    },

    // --- Required: tree mutation ---
    appendInitialChild(parentInstance, child) {
      fab.appendChild(parentInstance.node, child.node);
      parentInstance.children.push(child);
    },

    appendChild(parentInstance, child) {
      fab.appendChild(parentInstance.node, child.node);
      parentInstance.children.push(child);
    },

    appendChildToContainer(container, child) {
      const g = typeof globalThis !== 'undefined' ? globalThis : self;
      container.children.push(child);
      if (g._log) g._log('HOST appendChildToContainer tag=' + (child && child.tag) + ' total=' + container.children.length);
    },

    removeChildFromContainer(container, child) {
      const g = typeof globalThis !== 'undefined' ? globalThis : self;
      container.children = container.children.filter(c => c !== child);
      if (g._log) g._log('HOST removeChildFromContainer total=' + container.children.length);
    },

    removeChild(parentInstance, child) {
      parentInstance.children = parentInstance.children.filter(c => c !== child);
      // Fabric handles removal via completeRoot diff
    },

    insertBefore(parentInstance, child, beforeChild) {
      const idx = parentInstance.children.indexOf(beforeChild);
      if (idx >= 0) {
        parentInstance.children.splice(idx, 0, child);
      } else {
        parentInstance.children.push(child);
      }
    },

    insertInContainerBefore(container, child, beforeChild) {
      const idx = container.children.indexOf(beforeChild);
      if (idx >= 0) {
        container.children.splice(idx, 0, child);
      } else {
        container.children.push(child);
      }
    },

    // --- Required: commit/finalization ---
    finalizeInitialChildren() { return false; },
    prepareForCommit() { return null; },
    resetAfterCommit(container) {
      const g = typeof globalThis !== 'undefined' ? globalThis : self;
      if (g._log) g._log('HOST resetAfterCommit children=' + (container.children ? container.children.length : 'none'));
      const childSet = fab.createChildSet(rootTag);
      let count = 0;
      if (container.children) {
        for (const child of container.children) {
          if (g._log) g._log('HOST appendToSet child tag=' + (child && child.tag) + ' type=' + (child && child.type) + ' node=' + typeof (child && child.node));
          fab.appendChildToSet(childSet, child.node);
          count++;
        }
      }
      if (g._log) g._log('HOST completeRoot rootTag=' + rootTag + ' count=' + count);
      fab.completeRoot(rootTag, childSet);
      if (g._log) g._log('HOST completeRoot DONE');
    },

    // --- Required: updates ---
    prepareUpdate(instance, type, oldProps, newProps) {
      // Return a payload if props changed
      let updatePayload = null;
      const oldStyle = oldProps.style || {};
      const newStyle = newProps.style || {};
      // Simple diff: if any prop changed, return the new props
      for (const key in newProps) {
        if (key === 'children' || key === 'ref' || key === 'key') continue;
        if (newProps[key] !== oldProps[key]) {
          if (!updatePayload) updatePayload = {};
          updatePayload[key] = newProps[key];
        }
      }
      return updatePayload;
    },

    commitUpdate(instance, updatePayload, type, prevProps, nextProps, internalHandle) {
      // Clone the node with new props
      let flatProps = {};
      for (const key in updatePayload) {
        if (key === 'style') {
          const s = updatePayload.style;
          if (s) {
            const styles = Array.isArray(s) ? Object.assign({}, ...s) : s;
            for (const sk in styles) {
              flatProps[sk] = styles[sk];
            }
          }
        } else {
          flatProps[key] = updatePayload[key];
        }
      }
      instance.node = fab.cloneNodeWithNewProps(instance.node, flatProps);
    },

    commitTextUpdate(textInstance, oldText, newText) {
      textInstance.node = fab.cloneNodeWithNewProps(textInstance.node, { text: newText });
      textInstance.text = newText;
    },

    // --- Required: host context ---
    getRootHostContext() { return {}; },
    getChildHostContext() { return {}; },
    getPublicInstance(instance) { return instance; },

    // --- Required: scheduling & priority ---
    supportsMutation: true,
    supportsPersistence: false,
    supportsHydration: false,
    isPrimaryRenderer: true,
    warnsIfNotActing: false,
    noTimeout: -1,
    supportsMicrotasks: typeof queueMicrotask === 'function',
    scheduleMicrotask: typeof queueMicrotask === 'function' ? queueMicrotask : undefined,
    supportsTestSelectors: false,

    scheduleTimeout: typeof setTimeout === 'function' ? setTimeout : (fn) => fn(),
    cancelTimeout: typeof clearTimeout === 'function' ? clearTimeout : () => {},

    // Priority system
    getCurrentUpdatePriority() { return this._currentPriority || 32; },
    setCurrentUpdatePriority(priority) { this._currentPriority = priority; },
    resolveUpdatePriority() { return this._currentPriority || 32; /* DefaultEventPriority */ },
    shouldAttemptEagerTransition() { return false; },
    _currentPriority: 32,

    // Event priority
    getCurrentEventPriority() { return 32; /* DefaultEventPriority */ },
    resolveEventType() { return ''; },
    resolveEventTimeStamp() { return Date.now(); },
    trackSchedulerEvent() {},

    // Instance management
    getInstanceFromNode() { return null; },
    beforeActiveInstanceBlur() {},
    afterActiveInstanceBlur() {},
    prepareScopeUpdate() {},
    getInstanceFromScope() { return null; },
    detachDeletedInstance() {},
    requestPostPaintCallback() {},
    preparePortalMount() {},

    // Suspense
    maySuspendCommit() { return false; },
    preloadInstance() { return true; },
    startSuspendingCommit() {},
    suspendInstance() {},
    waitForCommitToBeReady() { return null; },
    NotPendingTransition: null,
    HostTransitionContext: null,
    resetFormInstance() {},

    // Visibility
    hideInstance() {},
    hideTextInstance() {},
    unhideInstance() {},
    unhideTextInstance() {},
    commitMount() {},
    resetTextContent() {},

    // View transitions (React 19)
    createViewTransitionInstance() { return null; },
    startViewTransition() {},
    cancelViewTransitionName() {},
    cancelRootViewTransitionName() {},
    restoreRootViewTransitionName() {},
    cloneRootViewTransitionContainer() { return null; },
    suspendOnActiveViewTransition() {},

    // Gesture transitions (React 19)
    getCurrentGestureOffset() { return null; },
    startGestureTransition() {},
    stopGestureTransition() {},
    subscribeToGestureDirection() {},

    // Fragment instances (React 19)
    createFragmentInstance() { return null; },
    commitNewChildToFragmentInstance() {},
    deleteChildFromFragmentInstance() {},
    updateFragmentInstanceFiber() {},
    hasInstanceChanged() { return false; },
    hasInstanceAffectedParent() { return false; },
    measureClonedInstance() {},

    // Console binding
    bindToConsole(methodName, args, badgeName) {
      return Function.prototype.bind.call(console[methodName], console, ...args);
    },

    // Dev tools
    rendererVersion: '0.0.1',
    rendererPackageName: 'onlook-fabric',
    extraDevToolsConfig: null,

    // Misc
    findFiberRoot() { return null; },
    getBoundingRect() { return null; },
    getTextContent() { return ''; },
    isHiddenSubtree() { return false; },
    matchAccessibilityRole() { return false; },
    setFocusIfFocusable() { return false; },
    setupIntersectionObserver() { return { observe(){}, unobserve(){} }; },

    shouldSetTextContent(type, props) {
      return false;
    },

    clearContainer(container) {
      container.children = [];
    },
  };
}
