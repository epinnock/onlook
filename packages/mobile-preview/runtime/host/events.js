import { bubbleEventThroughParentChain } from './bubbling.js';
import { createSyntheticEvent } from './synthetic-event.js';

const registeredFabricHosts = new WeakSet();
const eventHandlersByTag = new Map();
const parentTagByTag = new Map();

let lastFabricEvent = null;

export function dispatchFabricEvent(eventType, targetTag, payload) {
  lastFabricEvent = {
    eventType,
    targetTag,
    payload,
  };

  return lastFabricEvent;
}

export function registerFabricEventHandler(fab) {
  if (!fab || typeof fab.registerEventHandler !== 'function') {
    return false;
  }

  if (registeredFabricHosts.has(fab)) {
    return false;
  }

  fab.registerEventHandler((eventType, targetTag, payload) => {
    dispatchFabricEvent(eventType, targetTag, payload);
  });
  registeredFabricHosts.add(fab);

  return true;
}

export function registerHostInstanceEventHandlers(tag, props) {
  if (typeof tag !== 'number') {
    return {};
  }

  const nextHandlers = {};

  if (props && typeof props === 'object') {
    for (const [eventName, value] of Object.entries(props)) {
      if (eventName.startsWith('on') && typeof value === 'function') {
        nextHandlers[eventName] = value;
      }
    }
  }

  if (Object.keys(nextHandlers).length === 0) {
    eventHandlersByTag.delete(tag);
    return {};
  }

  eventHandlersByTag.set(tag, nextHandlers);
  return nextHandlers;
}

export function refreshHostInstanceEventHandlers(tag, props) {
  return registerHostInstanceEventHandlers(tag, props);
}

export function getHostInstanceEventHandlers(tag) {
  return eventHandlersByTag.get(tag) ?? null;
}

export function registerHostInstanceEventParent(tag, parentTag) {
  if (typeof tag !== 'number') {
    return null;
  }

  if (typeof parentTag !== 'number') {
    parentTagByTag.delete(tag);
    return null;
  }

  parentTagByTag.set(tag, parentTag);
  return parentTag;
}

export function getHostInstanceEventParentTag(tag) {
  return parentTagByTag.get(tag) ?? null;
}

export function dispatchBubbledEvent(eventName, eventType, targetTag, payload, options = {}) {
  return bubbleEventThroughParentChain({
    targetTag,
    eventName,
    getHandlers: getHostInstanceEventHandlers,
    getParentTag: getHostInstanceEventParentTag,
    createEvent(currentTarget) {
      return createSyntheticEvent(eventType, payload, {
        ...options,
        target: targetTag,
        currentTarget,
      });
    },
  });
}

export function __getLastFabricEventForTests() {
  return lastFabricEvent;
}

export function __getEventHandlerRegistryForTests() {
  return eventHandlersByTag;
}

export function __getEventParentRegistryForTests() {
  return parentTagByTag;
}

export function __resetFabricEventsForTests() {
  lastFabricEvent = null;
  eventHandlersByTag.clear();
  parentTagByTag.clear();
}
