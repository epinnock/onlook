import { createSyntheticEvent, createSyntheticNativeEvent } from './synthetic-event.js';

function normalizeNumber(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function normalizeSize(value) {
  if (!value || typeof value !== 'object') {
    return { width: 0, height: 0 };
  }

  return {
    width: normalizeNumber(value.width),
    height: normalizeNumber(value.height),
  };
}

function normalizePoint(value, fallbackX = 0, fallbackY = 0) {
  if (!value || typeof value !== 'object') {
    return { x: fallbackX, y: fallbackY };
  }

  return {
    x: normalizeNumber(value.x, fallbackX),
    y: normalizeNumber(value.y, fallbackY),
  };
}

function normalizeInset(value) {
  if (!value || typeof value !== 'object') {
    return { top: 0, left: 0, bottom: 0, right: 0 };
  }

  return {
    top: normalizeNumber(value.top),
    left: normalizeNumber(value.left),
    bottom: normalizeNumber(value.bottom),
    right: normalizeNumber(value.right),
  };
}

export function createScrollEventPayload(payload = {}) {
  const safePayload = payload && typeof payload === 'object' ? payload : {};

  return {
    contentOffset: normalizePoint(
      safePayload.contentOffset,
      normalizeNumber(safePayload.x),
      normalizeNumber(safePayload.y),
    ),
    contentInset: normalizeInset(safePayload.contentInset),
    contentSize: normalizeSize(safePayload.contentSize),
    layoutMeasurement: normalizeSize(safePayload.layoutMeasurement),
    velocity: normalizePoint(safePayload.velocity),
    zoomScale: normalizeNumber(safePayload.zoomScale, 1),
    responderIgnoreScroll:
      typeof safePayload.responderIgnoreScroll === 'boolean'
        ? safePayload.responderIgnoreScroll
        : true,
  };
}

export function createSyntheticScrollEvent(payload = {}, options = {}) {
  const scrollPayload = createScrollEventPayload(payload);

  return createSyntheticEvent(
    'topScroll',
    createSyntheticNativeEvent(scrollPayload, options),
    options,
  );
}
