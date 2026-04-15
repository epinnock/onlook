const registeredFabricHosts = new WeakSet();
const eventHandlersByTag = new Map();

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

export function getHostInstanceEventHandlers(tag) {
  return eventHandlersByTag.get(tag) ?? null;
}

export function __getLastFabricEventForTests() {
  return lastFabricEvent;
}

export function __getEventHandlerRegistryForTests() {
  return eventHandlersByTag;
}

export function __resetFabricEventsForTests() {
  lastFabricEvent = null;
  eventHandlersByTag.clear();
}
