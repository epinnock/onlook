function normalizeSize(size) {
  if (typeof size === 'number' && Number.isFinite(size)) {
    return size;
  }

  if (size === 'small' || size === 'large') {
    return size;
  }

  return size;
}

function mapProps(props = {}) {
  const nextProps = {
    ...props,
    animating: props.animating ?? true,
  };

  if ('size' in nextProps) {
    nextProps.size = normalizeSize(nextProps.size);
  }

  return nextProps;
}

export default {
  nativeType: 'RCTActivityIndicatorView',
  mapProps,
};
