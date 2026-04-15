function cloneObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return value;
  }

  return { ...value };
}

function cloneTouchLike(value, fallbackTarget, fallbackTimestamp) {
  if (!value || typeof value !== 'object') {
    return null;
  }

  const nextTouch = { ...value };

  if (nextTouch.target == null && fallbackTarget != null) {
    nextTouch.target = fallbackTarget;
  }

  if (nextTouch.timestamp == null && fallbackTimestamp != null) {
    nextTouch.timestamp = fallbackTimestamp;
  }

  if (nextTouch.identifier == null) {
    nextTouch.identifier = 0;
  }

  return nextTouch;
}

function normalizeTouchList(value, fallbackTouch) {
  if (!Array.isArray(value)) {
    return fallbackTouch ? [fallbackTouch] : [];
  }

  return value
    .map(entry =>
      cloneTouchLike(entry, fallbackTouch?.target, fallbackTouch?.timestamp),
    )
    .filter(Boolean);
}

function shouldBuildTouchPayload(payload) {
  return (
    payload.pageX != null ||
    payload.pageY != null ||
    payload.locationX != null ||
    payload.locationY != null ||
    Array.isArray(payload.touches) ||
    Array.isArray(payload.changedTouches)
  );
}

function buildTouchPayload(payload, targetTag, timestamp) {
  const baseTouch = cloneTouchLike(payload, targetTag, timestamp);
  const touches = normalizeTouchList(payload.touches, baseTouch);
  const changedTouches = normalizeTouchList(payload.changedTouches, baseTouch);

  return {
    ...payload,
    target: targetTag ?? payload.target ?? null,
    timestamp,
    touches,
    changedTouches: changedTouches.length > 0 ? changedTouches : touches,
  };
}

function buildNativeEvent(payload, targetTag, timestamp) {
  const basePayload = {
    ...payload,
    target: targetTag ?? payload.target ?? null,
    timestamp,
  };

  if (shouldBuildTouchPayload(payload)) {
    return buildTouchPayload(basePayload, targetTag, timestamp);
  }

  if (payload.contentOffset || payload.contentInset || payload.contentSize || payload.layoutMeasurement) {
    return {
      ...basePayload,
      contentOffset: cloneObject(payload.contentOffset) ?? { x: 0, y: 0 },
      contentInset: cloneObject(payload.contentInset) ?? { top: 0, left: 0, bottom: 0, right: 0 },
      contentSize: cloneObject(payload.contentSize) ?? { width: 0, height: 0 },
      layoutMeasurement:
        cloneObject(payload.layoutMeasurement) ?? { width: 0, height: 0 },
      zoomScale: payload.zoomScale ?? 1,
    };
  }

  return basePayload;
}

export function createSyntheticEvent(
  eventType,
  payload = {},
  options = {},
) {
  const safePayload = payload && typeof payload === 'object' ? payload : {};
  const timestamp = options.timestamp ?? safePayload.timestamp ?? Date.now();
  const target = options.target ?? safePayload.target ?? null;
  const currentTarget = options.currentTarget ?? target;
  const nativeEvent = buildNativeEvent(safePayload, target, timestamp);

  let defaultPrevented = false;
  let propagationStopped = false;

  const event = {
    type: eventType,
    target,
    currentTarget,
    nativeEvent,
    timeStamp: timestamp,
    defaultPrevented,
    preventDefault() {
      defaultPrevented = true;
      event.defaultPrevented = true;
    },
    isDefaultPrevented() {
      return defaultPrevented;
    },
    stopPropagation() {
      propagationStopped = true;
    },
    isPropagationStopped() {
      return propagationStopped;
    },
    persist() {},
  };

  return event;
}

export function createSyntheticNativeEvent(payload = {}, options = {}) {
  const safePayload = payload && typeof payload === 'object' ? payload : {};
  const timestamp = options.timestamp ?? safePayload.timestamp ?? Date.now();
  const target = options.target ?? safePayload.target ?? null;

  return buildNativeEvent(safePayload, target, timestamp);
}
