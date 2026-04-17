const SUPPORTED_OVERFLOW_VALUES = new Set(['hidden', 'scroll', 'visible']);
const OVERFLOW_ALIASES = {
  auto: 'scroll',
  clip: 'hidden',
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function parseFiniteNumber(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? value : null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const normalizedValue = value.trim();

  if (!normalizedValue) {
    return null;
  }

  if (normalizedValue.endsWith('%')) {
    const percentageValue = Number(normalizedValue.slice(0, -1));
    return Number.isFinite(percentageValue) ? percentageValue / 100 : null;
  }

  const parsedValue = Number(normalizedValue);
  return Number.isFinite(parsedValue) ? parsedValue : null;
}

function parseInteger(value) {
  if (typeof value === 'number') {
    return Number.isFinite(value) ? Math.trunc(value) : null;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const normalizedValue = value.trim();

  if (!/^[+-]?\d+$/.test(normalizedValue)) {
    return null;
  }

  return Number(normalizedValue);
}

function normalizeOpacity(value) {
  const parsedValue = parseFiniteNumber(value);

  if (parsedValue == null) {
    return { changed: false, value };
  }

  const normalizedValue = clamp(parsedValue, 0, 1);
  return {
    changed: normalizedValue !== value,
    value: normalizedValue,
  };
}

function normalizeOverflow(value) {
  if (typeof value !== 'string') {
    return { changed: false, value };
  }

  const normalizedValue = value.trim().toLowerCase();
  const resolvedValue = OVERFLOW_ALIASES[normalizedValue] ?? normalizedValue;

  if (!SUPPORTED_OVERFLOW_VALUES.has(resolvedValue)) {
    return { changed: false, value };
  }

  return {
    changed: resolvedValue !== value,
    value: resolvedValue,
  };
}

function normalizeZIndex(value) {
  const parsedValue = parseInteger(value);

  if (parsedValue == null) {
    return { changed: false, value };
  }

  return {
    changed: parsedValue !== value,
    value: parsedValue,
  };
}

function setStyleValue(sourceStyle, nextStyle, key, value) {
  const targetStyle = nextStyle ?? { ...sourceStyle };
  targetStyle[key] = value;
  return targetStyle;
}

function deleteStyleValue(sourceStyle, nextStyle, key) {
  if (!(key in sourceStyle) && (!nextStyle || !(key in nextStyle))) {
    return nextStyle;
  }

  const targetStyle = nextStyle ?? { ...sourceStyle };
  delete targetStyle[key];
  return targetStyle;
}

const layeringStyleResolver = {
  order: 100,
  resolve(style) {
    if (!style || typeof style !== 'object' || Array.isArray(style)) {
      return style;
    }

    let nextStyle = null;

    if ('opacity' in style) {
      const normalizedOpacity = normalizeOpacity(style.opacity);

      if (normalizedOpacity.changed) {
        nextStyle = setStyleValue(style, nextStyle, 'opacity', normalizedOpacity.value);
      }
    }

    if ('overflow' in style) {
      const normalizedOverflow = normalizeOverflow(style.overflow);

      if (normalizedOverflow.changed) {
        nextStyle = setStyleValue(style, nextStyle, 'overflow', normalizedOverflow.value);
      }
    }

    if ('zIndex' in style) {
      const normalizedZIndex = normalizeZIndex(style.zIndex);

      if (normalizedZIndex.changed) {
        nextStyle = setStyleValue(style, nextStyle, 'zIndex', normalizedZIndex.value);
      }

      nextStyle = deleteStyleValue(style, nextStyle, 'z-index');
      return nextStyle ?? style;
    }

    if (!('z-index' in style)) {
      return nextStyle ?? style;
    }

    const normalizedZIndex = normalizeZIndex(style['z-index']);

    if (!normalizedZIndex.changed && typeof style['z-index'] !== 'number') {
      return nextStyle ?? style;
    }

    nextStyle = setStyleValue(style, nextStyle, 'zIndex', normalizedZIndex.value);
    nextStyle = deleteStyleValue(style, nextStyle, 'z-index');
    return nextStyle ?? style;
  },
};

export default layeringStyleResolver;
