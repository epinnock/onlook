const SHADOW_STYLE_KEYS = new Set([
  'shadowColor',
  'shadowOffset',
  'shadowOpacity',
  'shadowRadius',
]);

function normalizeNumber(value, fallback = 0) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function hasShadowStyle(style) {
  if (!style || typeof style !== 'object') {
    return false;
  }

  for (const key of SHADOW_STYLE_KEYS) {
    if (key in style) {
      return true;
    }
  }

  return false;
}

function normalizeShadowOffset(value) {
  if (!value || typeof value !== 'object') {
    return { width: 0, height: 0 };
  }

  return {
    width: normalizeNumber(value.width),
    height: normalizeNumber(value.height),
  };
}

export default {
  id: 'shadow',
  order: 100,
  resolve(style) {
    if (!hasShadowStyle(style)) {
      return style;
    }

    const nextStyle = { ...style };

    if ('shadowOffset' in nextStyle) {
      nextStyle.shadowOffset = normalizeShadowOffset(nextStyle.shadowOffset);
    }

    return nextStyle;
  },
};
