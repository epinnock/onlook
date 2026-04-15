function hasFinitePositiveNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0;
}

function mapProps(props = {}) {
  const nextProps = {
    ...props,
    automaticallyAdjustContentInsets: props.automaticallyAdjustContentInsets ?? false,
  };

  if (
    typeof props.onScroll === 'function' &&
    !hasFinitePositiveNumber(props.scrollEventThrottle)
  ) {
    nextProps.scrollEventThrottle = 16;
  }

  return nextProps;
}

export default {
  nativeType: 'RCTScrollView',
  mapProps,
};
