import { getHostInstanceEventHandlers } from './events.js';
import { createSyntheticEvent } from './synthetic-event.js';

const textInputEventCountByTag = new Map();

function getNextEventCount(tag) {
  const currentCount = textInputEventCountByTag.get(tag) ?? 0;
  const nextCount = currentCount + 1;
  textInputEventCountByTag.set(tag, nextCount);
  return nextCount;
}

export function dispatchTextInputChangeEvent(tag, text, options = {}) {
  if (typeof tag !== 'number') {
    return null;
  }

  const handlers = getHostInstanceEventHandlers(tag);

  if (!handlers) {
    return null;
  }

  const nextText = text == null ? '' : String(text);
  const eventCount = options.eventCount ?? getNextEventCount(tag);
  const event = createSyntheticEvent(
    'topChange',
    {
      text: nextText,
      eventCount,
    },
    {
      target: tag,
      currentTarget: tag,
      timestamp: options.timestamp,
    },
  );

  if (typeof handlers.onChange === 'function') {
    handlers.onChange(event);
  }

  if (typeof handlers.onChangeText === 'function') {
    handlers.onChangeText(nextText);
  }

  return event;
}

export function __resetTextInputEventStateForTests() {
  textInputEventCountByTag.clear();
}
