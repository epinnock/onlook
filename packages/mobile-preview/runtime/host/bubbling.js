// @ts-nocheck — runtime shim, dynamically typed via JSDoc TODO; suppress checkJs in editor consumer.
const BUBBLING_EVENT_HANDLER_NAMES = new Set([
  'onPress',
  'onPressIn',
  'onPressOut',
  'onLongPress',
]);

export function shouldBubbleEventHandler(eventName) {
  return BUBBLING_EVENT_HANDLER_NAMES.has(eventName);
}

export function bubbleEventThroughParentChain({
  targetTag,
  eventName,
  getHandlers,
  getParentTag,
  createEvent,
}) {
  if (typeof targetTag !== 'number' || typeof getHandlers !== 'function') {
    return [];
  }

  const visitedTags = new Set();
  const dispatches = [];
  let currentTag = targetTag;
  let syntheticEvent = null;

  while (typeof currentTag === 'number' && !visitedTags.has(currentTag)) {
    visitedTags.add(currentTag);

    const handlers = getHandlers(currentTag);
    const handler =
      handlers && typeof handlers[eventName] === 'function'
        ? handlers[eventName]
        : null;

    if (handler) {
      if (!syntheticEvent) {
        syntheticEvent =
          typeof createEvent === 'function' ? createEvent(currentTag) : null;
      } else {
        syntheticEvent.currentTarget = currentTag;
      }

      const event = syntheticEvent ?? { target: targetTag, currentTarget: currentTag };
      const returnValue = handler(event);

      dispatches.push({
        currentTarget: currentTag,
        event,
        eventName,
        returnValue,
      });

      if (
        event &&
        typeof event.isPropagationStopped === 'function' &&
        event.isPropagationStopped()
      ) {
        break;
      }
    }

    if (!shouldBubbleEventHandler(eventName) || typeof getParentTag !== 'function') {
      break;
    }

    currentTag = getParentTag(currentTag);
  }

  return dispatches;
}
