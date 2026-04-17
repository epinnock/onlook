const textInputControlStateByTag = new Map();

function getControlState(tag) {
  const existingState = textInputControlStateByTag.get(tag);

  if (existingState) {
    return existingState;
  }

  const nextState = {
    eventCount: 0,
    hasMounted: false,
    nativeText: null,
  };

  textInputControlStateByTag.set(tag, nextState);
  return nextState;
}

function normalizeTextValue(value) {
  if (value == null) {
    return null;
  }

  return String(value);
}

export function recordTextInputNativeValue(tag, text, options = {}) {
  if (typeof tag !== 'number') {
    return null;
  }

  const state = getControlState(tag);
  const nextText = normalizeTextValue(text) ?? '';
  const nextEventCount =
    typeof options.eventCount === 'number' && Number.isFinite(options.eventCount)
      ? Math.max(state.eventCount, Math.trunc(options.eventCount))
      : state.eventCount + 1;

  state.nativeText = nextText;
  state.eventCount = nextEventCount;
  state.hasMounted = true;

  return {
    text: state.nativeText,
    eventCount: state.eventCount,
  };
}

export function resolveControlledTextInputProps(tag, props = {}) {
  if (typeof tag !== 'number' || !props || typeof props !== 'object') {
    return props;
  }

  const state = getControlState(tag);
  const nextProps = {
    ...props,
  };

  const controlledText = normalizeTextValue(props.value);

  delete nextProps.value;
  delete nextProps.defaultValue;

  if (controlledText != null) {
    state.nativeText = controlledText;
    state.hasMounted = true;
    nextProps.text = controlledText;
    nextProps.mostRecentEventCount = state.eventCount;
    return nextProps;
  }

  if (!state.hasMounted) {
    const initialText =
      normalizeTextValue(props.text) ??
      normalizeTextValue(props.defaultValue);

    if (initialText != null) {
      state.nativeText = initialText;
      nextProps.text = initialText;
    }

    state.hasMounted = true;
    return nextProps;
  }

  if (state.nativeText != null) {
    nextProps.text = state.nativeText;
  } else {
    delete nextProps.text;
  }

  return nextProps;
}

export function __resetTextInputControlStateForTests() {
  textInputControlStateByTag.clear();
}
