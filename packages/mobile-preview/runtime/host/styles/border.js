const BORDER_STYLE_VALUES = new Set(['solid', 'dashed', 'dotted']);
const BORDER_WIDTH_KEYS = [
  'borderWidth',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'borderStartWidth',
  'borderEndWidth',
  'borderBlockWidth',
  'borderInlineWidth',
];
const BORDER_STYLE_KEYS = [
  'borderStyle',
  'borderTopStyle',
  'borderRightStyle',
  'borderBottomStyle',
  'borderLeftStyle',
  'borderStartStyle',
  'borderEndStyle',
  'borderBlockStyle',
  'borderInlineStyle',
];
const BORDER_SHORTHAND_KEYS = {
  border: [''],
  borderTop: ['Top'],
  borderRight: ['Right'],
  borderBottom: ['Bottom'],
  borderLeft: ['Left'],
  borderStart: ['Start'],
  borderEnd: ['End'],
  borderBlock: ['Top', 'Bottom'],
  borderInline: ['Left', 'Right'],
};
const LOGICAL_BORDER_KEYS = {
  borderBlockWidth: ['borderTopWidth', 'borderBottomWidth'],
  borderBlockColor: ['borderTopColor', 'borderBottomColor'],
  borderBlockStyle: ['borderTopStyle', 'borderBottomStyle'],
  borderInlineWidth: ['borderLeftWidth', 'borderRightWidth'],
  borderInlineColor: ['borderLeftColor', 'borderRightColor'],
  borderInlineStyle: ['borderLeftStyle', 'borderRightStyle'],
};

function hasOwn(style, key) {
  return Object.prototype.hasOwnProperty.call(style, key);
}

function normalizeBorderStyleValue(value) {
  if (typeof value !== 'string') {
    return value;
  }

  const normalizedValue = value.trim().toLowerCase();
  return BORDER_STYLE_VALUES.has(normalizedValue) ? normalizedValue : value;
}

function parseBorderWidthValue(value) {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value !== 'string') {
    return undefined;
  }

  const normalizedValue = value.trim().toLowerCase();

  if (!/^-?(?:\d+|\d*\.\d+)(?:px)?$/.test(normalizedValue)) {
    return undefined;
  }

  return Number.parseFloat(normalizedValue.replace(/px$/, ''));
}

function parseBorderShorthand(value, styleHelpers) {
  if (typeof value === 'number') {
    return { width: value };
  }

  if (typeof value === 'string') {
    const trimmedValue = value.trim();

    if (!trimmedValue) {
      return null;
    }

    let style;
    let remainder = trimmedValue.replace(/\b(solid|dashed|dotted)\b/i, match => {
      style = match.toLowerCase();
      return ' ';
    });
    let width;
    const colorTokens = [];

    for (const token of remainder.split(/\s+/).filter(Boolean)) {
      if (typeof width === 'undefined') {
        const parsedWidth = parseBorderWidthValue(token);

        if (typeof parsedWidth !== 'undefined') {
          width = parsedWidth;
          continue;
        }
      }

      colorTokens.push(token);
    }

    const colorValue = colorTokens.join(' ').trim();
    const parsed = {};

    if (typeof width !== 'undefined') {
      parsed.width = width;
    }

    if (typeof style !== 'undefined') {
      parsed.style = style;
    }

    if (colorValue) {
      parsed.color = styleHelpers.cssColorToArgb(colorValue);
    }

    return Object.keys(parsed).length > 0 ? parsed : null;
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const parsed = {};
  const width = parseBorderWidthValue(value.width);

  if (typeof width !== 'undefined') {
    parsed.width = width;
  } else if (hasOwn(value, 'width')) {
    parsed.width = value.width;
  }

  if (hasOwn(value, 'style')) {
    parsed.style = normalizeBorderStyleValue(value.style);
  }

  if (hasOwn(value, 'color')) {
    parsed.color = styleHelpers.cssColorToArgb(value.color);
  }

  return Object.keys(parsed).length > 0 ? parsed : null;
}

function getBorderPropName(sideSuffix, propName) {
  const capitalizedPropName = propName[0].toUpperCase() + propName.slice(1);
  return `border${sideSuffix}${capitalizedPropName}`;
}

function assignShorthandProps(style, sideSuffixes, parsedBorderValue) {
  if (!parsedBorderValue) {
    return;
  }

  for (const sideSuffix of sideSuffixes) {
    for (const propName of ['width', 'style', 'color']) {
      const value = parsedBorderValue[propName];

      if (typeof value === 'undefined') {
        continue;
      }

      const targetKey = getBorderPropName(sideSuffix, propName);

      if (!hasOwn(style, targetKey)) {
        style[targetKey] = value;
      }
    }
  }
}

const borderStyleResolver = {
  id: 'border',
  resolve(style, context) {
    if (!style || typeof style !== 'object' || Array.isArray(style)) {
      return style;
    }

    const resolvedStyle = { ...style };

    for (const key of BORDER_WIDTH_KEYS) {
      if (!hasOwn(resolvedStyle, key)) {
        continue;
      }

      const normalizedWidth = parseBorderWidthValue(resolvedStyle[key]);

      if (typeof normalizedWidth !== 'undefined') {
        resolvedStyle[key] = normalizedWidth;
      }
    }

    for (const key of BORDER_STYLE_KEYS) {
      if (!hasOwn(resolvedStyle, key)) {
        continue;
      }

      resolvedStyle[key] = normalizeBorderStyleValue(resolvedStyle[key]);
    }

    for (const [sourceKey, targetKeys] of Object.entries(LOGICAL_BORDER_KEYS)) {
      if (!hasOwn(resolvedStyle, sourceKey)) {
        continue;
      }

      for (const targetKey of targetKeys) {
        if (!hasOwn(resolvedStyle, targetKey)) {
          resolvedStyle[targetKey] = resolvedStyle[sourceKey];
        }
      }

      delete resolvedStyle[sourceKey];
    }

    for (const [sourceKey, sideSuffixes] of Object.entries(BORDER_SHORTHAND_KEYS)) {
      if (!hasOwn(resolvedStyle, sourceKey)) {
        continue;
      }

      assignShorthandProps(
        resolvedStyle,
        sideSuffixes,
        parseBorderShorthand(resolvedStyle[sourceKey], context.styleHelpers),
      );
      delete resolvedStyle[sourceKey];
    }

    return resolvedStyle;
  },
};

export default borderStyleResolver;
