import { dispatchBubbledEvent } from './events.js';

const BUTTON_COMPONENT_TYPES = new Set(['Button']);
const PRESS_COMPONENT_TYPES = new Set([
  'Button',
  'Pressable',
  'TouchableHighlight',
  'TouchableOpacity',
  'TouchableWithoutFeedback',
]);

const PRESS_EVENT_HANDLER_SEQUENCES = new Map([
  ['longPress', ['onLongPress']],
  ['press', ['onPress']],
  ['pressIn', ['onPressIn']],
  ['pressOut', ['onPressOut']],
  ['topTouchCancel', ['onPressOut']],
  ['topTouchEnd', ['onPressOut', 'onPress']],
  ['topTouchStart', ['onPressIn']],
]);

function normalizePressEventType(eventType) {
  if (typeof eventType !== 'string') {
    return '';
  }

  return eventType.trim();
}

export function isPressComponentType(componentType) {
  return typeof componentType === 'string' && PRESS_COMPONENT_TYPES.has(componentType);
}

export function resolvePressEventHandlerNames(eventType, componentType) {
  if (!isPressComponentType(componentType)) {
    return [];
  }

  const normalizedEventType = normalizePressEventType(eventType);
  const handlerNames = PRESS_EVENT_HANDLER_SEQUENCES.get(normalizedEventType) ?? [];

  if (BUTTON_COMPONENT_TYPES.has(componentType)) {
    return handlerNames.filter(handlerName => handlerName === 'onPress');
  }

  return [...handlerNames];
}

export function dispatchPressEvent(eventType, targetTag, payload = {}, options = {}) {
  const handlerNames = resolvePressEventHandlerNames(eventType, options.componentType);

  if (handlerNames.length === 0) {
    return [];
  }

  const dispatches = [];

  for (const handlerName of handlerNames) {
    dispatches.push(
      ...dispatchBubbledEvent(handlerName, eventType, targetTag, payload, options),
    );
  }

  return dispatches;
}
