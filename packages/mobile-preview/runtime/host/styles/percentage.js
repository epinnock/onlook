const WIDTH_DIMENSION_KEYS = new Set(['width', 'minWidth', 'maxWidth']);
const HEIGHT_DIMENSION_KEYS = new Set(['height', 'minHeight', 'maxHeight']);
const PERCENTAGE_VALUE_PATTERN = /^([+-]?(?:\d+\.?\d*|\.\d+))%$/;

function getParentDimension(parentLayout, key) {
  if (!parentLayout || typeof parentLayout !== 'object') {
    return null;
  }

  const value = parentLayout[key];
  return Number.isFinite(value) ? value : null;
}

function resolvePercentageValue(value, parentSize) {
  if (typeof value !== 'string' || parentSize == null) {
    return null;
  }

  const match = value.trim().match(PERCENTAGE_VALUE_PATTERN);

  if (!match) {
    return null;
  }

  return (parentSize * parseFloat(match[1])) / 100;
}

export default {
  id: 'percentage',
  resolve(style, context) {
    if (!style || typeof style !== 'object' || Array.isArray(style)) {
      return style;
    }

    const parentWidth = getParentDimension(context.parentLayout, 'width');
    const parentHeight = getParentDimension(context.parentLayout, 'height');
    let resolvedStyle = style;

    for (const key in style) {
      const value = style[key];
      const parentSize = WIDTH_DIMENSION_KEYS.has(key)
        ? parentWidth
        : HEIGHT_DIMENSION_KEYS.has(key)
          ? parentHeight
          : null;
      const resolvedValue = resolvePercentageValue(value, parentSize);

      if (resolvedValue == null || resolvedValue === value) {
        continue;
      }

      if (resolvedStyle === style) {
        resolvedStyle = { ...style };
      }

      resolvedStyle[key] = resolvedValue;
    }

    return resolvedStyle;
  },
};
