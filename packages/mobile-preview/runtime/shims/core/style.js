const STYLE_HELPERS_GLOBAL_KEY = '__onlookStyleHelpers';
const COLOR_STYLE_KEYS = new Set([
  'color',
  'backgroundColor',
  'borderColor',
  'borderTopColor',
  'borderBottomColor',
  'borderLeftColor',
  'borderRightColor',
  'borderStartColor',
  'borderEndColor',
  'borderBlockColor',
  'borderInlineColor',
  'shadowColor',
  'tintColor',
  'overlayColor',
  'textDecorationColor',
  'textShadowColor',
  'placeholderTextColor',
  'underlineColorAndroid',
]);

function clampColorChannel(value) {
  return Math.max(0, Math.min(255, value));
}

function cssColorToArgb(value) {
  if (typeof value === 'number') {
    return value | 0;
  }

  if (typeof value !== 'string') {
    return value;
  }

  const normalizedValue = value.trim().toLowerCase();

  if (normalizedValue === 'transparent') {
    return 0;
  }

  if (normalizedValue === 'black') {
    return 0xFF000000 | 0;
  }

  if (normalizedValue === 'white') {
    return 0xFFFFFFFF | 0;
  }

  if (normalizedValue[0] === '#') {
    const hex = normalizedValue.slice(1);
    const parseHex = hexValue => parseInt(hexValue, 16);

    if (hex.length === 3) {
      const r = parseHex(hex[0] + hex[0]);
      const g = parseHex(hex[1] + hex[1]);
      const b = parseHex(hex[2] + hex[2]);
      return ((0xFF << 24) | (r << 16) | (g << 8) | b) | 0;
    }

    if (hex.length === 6) {
      const r = parseHex(hex.slice(0, 2));
      const g = parseHex(hex.slice(2, 4));
      const b = parseHex(hex.slice(4, 6));
      return ((0xFF << 24) | (r << 16) | (g << 8) | b) | 0;
    }

    if (hex.length === 8) {
      const r = parseHex(hex.slice(0, 2));
      const g = parseHex(hex.slice(2, 4));
      const b = parseHex(hex.slice(4, 6));
      const a = parseHex(hex.slice(6, 8));
      return ((a << 24) | (r << 16) | (g << 8) | b) | 0;
    }
  }

  const rgba = normalizedValue.match(
    /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*(\d*\.?\d+)\s*)?\)$/,
  );

  if (!rgba) {
    return value;
  }

  const r = clampColorChannel(parseInt(rgba[1], 10));
  const g = clampColorChannel(parseInt(rgba[2], 10));
  const b = clampColorChannel(parseInt(rgba[3], 10));
  const a =
    rgba[4] != null ? clampColorChannel(Math.round(parseFloat(rgba[4]) * 255)) : 0xFF;

  return ((a << 24) | (r << 16) | (g << 8) | b) | 0;
}

function convertStyleColors(style) {
  if (!style || typeof style !== 'object' || Array.isArray(style)) {
    return style;
  }

  let changed = false;
  const convertedStyle = {};

  for (const key in style) {
    const value = style[key];

    if (COLOR_STYLE_KEYS.has(key)) {
      const convertedValue = cssColorToArgb(value);
      if (convertedValue !== value) {
        changed = true;
      }
      convertedStyle[key] = convertedValue;
      continue;
    }

    convertedStyle[key] = value;
  }

  return changed ? convertedStyle : style;
}

function flattenStyle(style) {
  if (Array.isArray(style)) {
    return style.reduce((flattenedStyle, item) => {
      if (item && typeof item === 'object') {
        Object.assign(flattenedStyle, flattenStyle(item));
      }

      return flattenedStyle;
    }, {});
  }

  return convertStyleColors(style && typeof style === 'object' ? style : {});
}

function createStyleSheet(styles) {
  if (!styles || typeof styles !== 'object') {
    return {};
  }

  const normalizedStyles = {};

  for (const key in styles) {
    normalizedStyles[key] = convertStyleColors(styles[key]);
  }

  return normalizedStyles;
}

function composeStyles(a, b) {
  return Object.assign({}, flattenStyle(a), flattenStyle(b));
}

function createOnlookStyleHelpers() {
  return {
    composeStyles,
    convertStyleColors,
    createStyleSheet,
    cssColorToArgb,
    flattenStyle,
  };
}

function installStyleHelpers(target) {
  if (!target || (typeof target !== 'object' && typeof target !== 'function')) {
    return createOnlookStyleHelpers();
  }

  if (target[STYLE_HELPERS_GLOBAL_KEY]) {
    return target[STYLE_HELPERS_GLOBAL_KEY];
  }

  const helpers = createOnlookStyleHelpers();
  target[STYLE_HELPERS_GLOBAL_KEY] = helpers;
  return helpers;
}

function applyRuntimeShim(target) {
  installStyleHelpers(target);
  return target;
}

module.exports = {
  id: 'core/style',
  STYLE_HELPERS_GLOBAL_KEY,
  applyRuntimeShim,
  composeStyles,
  convertStyleColors,
  createOnlookStyleHelpers,
  createStyleSheet,
  cssColorToArgb,
  flattenStyle,
  install: installStyleHelpers,
  installStyleHelpers,
};
