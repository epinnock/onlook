const {
  MODULE_ID,
  RUNTIME_SHIM_REGISTRY_KEY,
  ensureRuntimeShimRegistry,
  mergeRuntimeModule,
} = require('./react-native-gesture-handler-root.js');
const { dispatchBubbledEvent } = require('../../host/events.js');
const { dispatchPressEvent } = require('../../host/events-press.js');
const { createScrollEventPayload } = require('../../host/events-scroll.js');

const GESTURE_PRESS_COMPONENT_TYPES = new Set([
  'LongPressGestureHandler',
  'TapGestureHandler',
]);
const GESTURE_SCROLL_COMPONENT_TYPES = new Set([
  'NativeViewGestureHandler',
  'PanGestureHandler',
]);

const State = Object.freeze({
  UNDETERMINED: 0,
  FAILED: 1,
  BEGAN: 2,
  CANCELLED: 3,
  ACTIVE: 4,
  END: 5,
});

function normalizeNumber(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeGestureState(value) {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : State.UNDETERMINED;
}

function resolveReact(target) {
  const candidate = target && target.React;

  if (candidate && typeof candidate === 'object' && candidate.default) {
    return candidate.default;
  }

  if (candidate) {
    return candidate;
  }

  return require('react');
}

function createPassthroughGestureHandler(target, displayName) {
  function GestureHandler(props) {
    const React = resolveReact(target);

    return React.createElement(React.Fragment, null, props?.children ?? null);
  }

  GestureHandler.displayName = displayName;
  return GestureHandler;
}

function isGesturePressHandlerType(componentType) {
  return typeof componentType === 'string' && GESTURE_PRESS_COMPONENT_TYPES.has(componentType);
}

function isGestureScrollHandlerType(componentType) {
  return typeof componentType === 'string' && GESTURE_SCROLL_COMPONENT_TYPES.has(componentType);
}

function isGestureHandlerComponentType(componentType) {
  return isGesturePressHandlerType(componentType) || isGestureScrollHandlerType(componentType);
}

function resolvePressEventType(componentType, state) {
  if (componentType === 'TapGestureHandler') {
    switch (state) {
      case State.BEGAN:
        return 'topTouchStart';
      case State.END:
        return 'topTouchEnd';
      case State.CANCELLED:
      case State.FAILED:
        return 'topTouchCancel';
      default:
        return '';
    }
  }

  if (componentType === 'LongPressGestureHandler') {
    switch (state) {
      case State.BEGAN:
        return 'topTouchStart';
      case State.ACTIVE:
        return 'longPress';
      case State.END:
      case State.CANCELLED:
      case State.FAILED:
        return 'topTouchCancel';
      default:
        return '';
    }
  }

  return '';
}

function resolvePressComponentType(componentType) {
  if (componentType === 'LongPressGestureHandler') {
    return 'TouchableOpacity';
  }

  if (componentType === 'TapGestureHandler') {
    return 'Pressable';
  }

  return '';
}

function createGestureScrollPayload(payload = {}) {
  const safePayload = payload && typeof payload === 'object' ? payload : {};

  return createScrollEventPayload({
    x: normalizeNumber(safePayload.translationX, normalizeNumber(safePayload.x)),
    y: normalizeNumber(safePayload.translationY, normalizeNumber(safePayload.y)),
    contentInset: safePayload.contentInset,
    contentSize: safePayload.contentSize,
    layoutMeasurement: safePayload.layoutMeasurement,
    velocity: {
      x: normalizeNumber(safePayload.velocityX),
      y: normalizeNumber(safePayload.velocityY),
    },
    zoomScale: normalizeNumber(
      safePayload.scale,
      normalizeNumber(safePayload.zoomScale, 1),
    ),
    responderIgnoreScroll:
      typeof safePayload.responderIgnoreScroll === 'boolean'
        ? safePayload.responderIgnoreScroll
        : true,
  });
}

function createGesturePressPayload(payload = {}) {
  if (!payload || typeof payload !== 'object') {
    return {};
  }

  const {
    absoluteX,
    absoluteY,
    numberOfPointers,
    oldState,
    scale,
    state,
    translationX,
    translationY,
    velocityX,
    velocityY,
    x,
    y,
    ...nextPayload
  } = payload;

  return nextPayload;
}

function shouldDispatchScrollState(state) {
  return state === State.BEGAN || state === State.ACTIVE || state === State.END;
}

function dispatchGestureHandlerEvent(eventType, targetTag, payload = {}, options = {}) {
  const componentType =
    typeof options.componentType === 'string' ? options.componentType : '';
  const state = normalizeGestureState(options.state ?? payload.state);

  if (isGesturePressHandlerType(componentType)) {
    const pressEventType = resolvePressEventType(componentType, state);

    if (!pressEventType) {
      return [];
    }

    return dispatchPressEvent(pressEventType, targetTag, createGesturePressPayload(payload), {
      ...options,
      componentType: resolvePressComponentType(componentType),
    });
  }

  if (isGestureScrollHandlerType(componentType) && shouldDispatchScrollState(state)) {
    return dispatchBubbledEvent(
      'onScroll',
      'topScroll',
      targetTag,
      createGestureScrollPayload(payload),
      options,
    );
  }

  return [];
}

function createReactNativeGestureHandlerEventsModule(target = globalThis) {
  const moduleExports = {
    State,
    TapGestureHandler: createPassthroughGestureHandler(target, 'TapGestureHandler'),
    LongPressGestureHandler: createPassthroughGestureHandler(
      target,
      'LongPressGestureHandler',
    ),
    PanGestureHandler: createPassthroughGestureHandler(target, 'PanGestureHandler'),
    NativeViewGestureHandler: createPassthroughGestureHandler(
      target,
      'NativeViewGestureHandler',
    ),
    dispatchGestureHandlerEvent,
    createGestureScrollPayload,
    isGestureHandlerComponentType,
    isGesturePressHandlerType,
    isGestureScrollHandlerType,
    resolvePressEventType,
  };

  moduleExports.default = moduleExports;
  moduleExports.__esModule = true;

  return moduleExports;
}

function installReactNativeGestureHandlerEvents(target = globalThis) {
  const registry = ensureRuntimeShimRegistry(target);
  const existingModule = registry[MODULE_ID];
  const gestureHandlerEventsModule =
    createReactNativeGestureHandlerEventsModule(target);

  if (existingModule && typeof existingModule === 'object') {
    return mergeRuntimeModule(existingModule, gestureHandlerEventsModule);
  }

  registry[MODULE_ID] = gestureHandlerEventsModule;
  return gestureHandlerEventsModule;
}

module.exports = installReactNativeGestureHandlerEvents;
module.exports.install = installReactNativeGestureHandlerEvents;
module.exports.applyRuntimeShim = installReactNativeGestureHandlerEvents;
module.exports.createReactNativeGestureHandlerEventsModule =
  createReactNativeGestureHandlerEventsModule;
module.exports.dispatchGestureHandlerEvent = dispatchGestureHandlerEvent;
module.exports.createGesturePressPayload = createGesturePressPayload;
module.exports.createGestureScrollPayload = createGestureScrollPayload;
module.exports.isGestureHandlerComponentType = isGestureHandlerComponentType;
module.exports.isGesturePressHandlerType = isGesturePressHandlerType;
module.exports.isGestureScrollHandlerType = isGestureScrollHandlerType;
module.exports.resolvePressEventType = resolvePressEventType;
module.exports.State = State;
module.exports.MODULE_ID = MODULE_ID;
module.exports.RUNTIME_SHIM_REGISTRY_KEY = RUNTIME_SHIM_REGISTRY_KEY;
