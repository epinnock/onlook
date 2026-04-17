function normalizeBoolean(value) {
  return Boolean(value);
}

function normalizeTrackColor(trackColor, iosBackgroundColor) {
  const normalizedTrackColor =
    trackColor && typeof trackColor === 'object' ? trackColor : null;

  return {
    false: normalizedTrackColor?.false ?? iosBackgroundColor,
    true: normalizedTrackColor?.true,
  };
}

function mapProps(props = {}) {
  const nextProps = {
    ...props,
    disabled: normalizeBoolean(props.disabled),
    value: normalizeBoolean(props.value),
  };
  const trackColor = normalizeTrackColor(props.trackColor, props.ios_backgroundColor);

  if (props.thumbColor != null) {
    nextProps.thumbTintColor = props.thumbColor;
  }

  if (trackColor.false != null) {
    nextProps.tintColor = trackColor.false;
  }

  if (trackColor.true != null) {
    nextProps.onTintColor = trackColor.true;
  }

  delete nextProps.thumbColor;
  delete nextProps.trackColor;
  delete nextProps.ios_backgroundColor;

  return nextProps;
}

export default {
  nativeType: 'RCTSwitch',
  mapProps,
};
