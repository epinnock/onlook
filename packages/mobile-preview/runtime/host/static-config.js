export const STATIC_HOST_CONFIG = {
  finalizeInitialChildren() {
    return false;
  },

  prepareForCommit() {
    return null;
  },

  getRootHostContext() {
    return {};
  },

  getChildHostContext() {
    return {};
  },

  getPublicInstance(instance) {
    return instance;
  },

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

  getCurrentUpdatePriority() {
    return this._currentPriority || 32;
  },

  setCurrentUpdatePriority(priority) {
    this._currentPriority = priority;
  },

  resolveUpdatePriority() {
    return this._currentPriority || 32;
  },

  shouldAttemptEagerTransition() {
    return false;
  },

  _currentPriority: 32,

  getCurrentEventPriority() {
    return 32;
  },

  resolveEventType() {
    return '';
  },

  resolveEventTimeStamp() {
    return Date.now();
  },

  trackSchedulerEvent() {},

  getInstanceFromNode() {
    return null;
  },

  beforeActiveInstanceBlur() {},
  afterActiveInstanceBlur() {},
  prepareScopeUpdate() {},

  getInstanceFromScope() {
    return null;
  },

  detachDeletedInstance() {},
  requestPostPaintCallback() {},
  preparePortalMount() {},

  maySuspendCommit() {
    return false;
  },

  preloadInstance() {
    return true;
  },

  startSuspendingCommit() {},
  suspendInstance() {},

  waitForCommitToBeReady() {
    return null;
  },

  NotPendingTransition: null,
  HostTransitionContext: null,

  resetFormInstance() {},
  hideInstance() {},
  hideTextInstance() {},
  unhideInstance() {},
  unhideTextInstance() {},
  commitMount() {},
  resetTextContent() {},

  createViewTransitionInstance() {
    return null;
  },

  startViewTransition() {},
  cancelViewTransitionName() {},
  cancelRootViewTransitionName() {},
  restoreRootViewTransitionName() {},

  cloneRootViewTransitionContainer() {
    return null;
  },

  suspendOnActiveViewTransition() {},

  getCurrentGestureOffset() {
    return null;
  },

  startGestureTransition() {},
  stopGestureTransition() {},
  subscribeToGestureDirection() {},

  createFragmentInstance() {
    return null;
  },

  commitNewChildToFragmentInstance() {},
  deleteChildFromFragmentInstance() {},
  updateFragmentInstanceFiber() {},

  hasInstanceChanged() {
    return false;
  },

  hasInstanceAffectedParent() {
    return false;
  },

  measureClonedInstance() {},

  bindToConsole(methodName, args) {
    return Function.prototype.bind.call(console[methodName], console, ...args);
  },

  rendererVersion: '0.0.1',
  rendererPackageName: 'onlook-fabric',
  extraDevToolsConfig: null,

  findFiberRoot() {
    return null;
  },

  getBoundingRect() {
    return null;
  },

  getTextContent() {
    return '';
  },

  isHiddenSubtree() {
    return false;
  },

  matchAccessibilityRole() {
    return false;
  },

  setFocusIfFocusable() {
    return false;
  },

  setupIntersectionObserver() {
    return {
      observe() {},
      unobserve() {},
    };
  },

  shouldSetTextContent() {
    return false;
  },
};
