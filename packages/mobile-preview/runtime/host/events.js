const registeredFabricHosts = new WeakSet();

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

export function __getLastFabricEventForTests() {
  return lastFabricEvent;
}

export function __resetFabricEventsForTests() {
  lastFabricEvent = null;
}
