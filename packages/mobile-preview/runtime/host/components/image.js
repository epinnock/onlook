const RESIZE_MODES = new Set(['cover', 'contain', 'stretch', 'repeat', 'center']);

function normalizeResizeMode(resizeMode) {
  if (typeof resizeMode !== 'string') {
    return 'cover';
  }

  return RESIZE_MODES.has(resizeMode) ? resizeMode : 'cover';
}

function normalizeSourceEntry(source) {
  if (typeof source === 'string' && source) {
    return { uri: source };
  }

  if (source && typeof source === 'object' && typeof source.uri === 'string' && source.uri) {
    return { ...source };
  }

  return null;
}

function normalizeSource(source) {
  if (Array.isArray(source)) {
    const normalizedSources = source.map(normalizeSourceEntry).filter(Boolean);
    return normalizedSources.length > 0 ? normalizedSources : source;
  }

  return normalizeSourceEntry(source) ?? source;
}

function mapProps(props = {}) {
  const nextProps = {
    ...props,
    resizeMode: normalizeResizeMode(props.resizeMode),
  };

  if ('source' in nextProps) {
    nextProps.source = normalizeSource(nextProps.source);
  }

  return nextProps;
}

export default {
  nativeType: 'RCTImageView',
  mapProps,
};
