const TEXT_DECORATION_LINE_TOKENS = new Set(['none', 'underline', 'line-through']);
const TEXT_DECORATION_STYLE_TOKENS = new Set(['solid', 'double', 'dotted', 'dashed']);

function cloneTextShadowOffset(textShadowOffset) {
  if (!textShadowOffset || typeof textShadowOffset !== 'object' || Array.isArray(textShadowOffset)) {
    return textShadowOffset;
  }

  const nextTextShadowOffset = {};

  if ('width' in textShadowOffset) {
    nextTextShadowOffset.width = textShadowOffset.width;
  }

  if ('height' in textShadowOffset) {
    nextTextShadowOffset.height = textShadowOffset.height;
  }

  return nextTextShadowOffset;
}

function parseNumericStyleValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value !== 'string') {
    return null;
  }

  const trimmedValue = value.trim();
  const match = trimmedValue.match(/^-?(?:\d+|\d*\.\d+)(px)?$/);

  if (!match) {
    return null;
  }

  return Number.parseFloat(trimmedValue);
}

function splitStyleTokens(value) {
  if (typeof value !== 'string') {
    return [];
  }

  const tokens = [];
  let token = '';
  let parenthesisDepth = 0;

  for (const character of value.trim()) {
    if (/\s/.test(character) && parenthesisDepth === 0) {
      if (token) {
        tokens.push(token);
        token = '';
      }
      continue;
    }

    if (character === '(') {
      parenthesisDepth += 1;
    } else if (character === ')' && parenthesisDepth > 0) {
      parenthesisDepth -= 1;
    }

    token += character;
  }

  if (token) {
    tokens.push(token);
  }

  return tokens;
}

function isRecognizedColorToken(token, styleHelpers) {
  if (typeof token !== 'string') {
    return false;
  }

  const trimmedToken = token.trim();

  if (!trimmedToken) {
    return false;
  }

  if (
    trimmedToken[0] === '#' ||
    /^rgba?\(/i.test(trimmedToken) ||
    /^(?:black|white|transparent)$/i.test(trimmedToken)
  ) {
    return true;
  }

  return styleHelpers?.cssColorToArgb?.(trimmedToken) !== trimmedToken;
}

function normalizeColorToken(token, styleHelpers) {
  return styleHelpers?.cssColorToArgb?.(token) ?? token;
}

function parseTextShadow(value, styleHelpers) {
  const tokens = splitStyleTokens(value);

  if (tokens.length === 0) {
    return null;
  }

  if (tokens.length === 1 && tokens[0].toLowerCase() === 'none') {
    return {};
  }

  const lengths = [];
  let color;

  for (const token of tokens) {
    const numericValue = parseNumericStyleValue(token);

    if (numericValue !== null) {
      lengths.push(numericValue);
      continue;
    }

    if (!color && isRecognizedColorToken(token, styleHelpers)) {
      color = normalizeColorToken(token, styleHelpers);
      continue;
    }

    return null;
  }

  if (lengths.length < 2 || lengths.length > 3) {
    return null;
  }

  const resolvedTextShadow = {
    textShadowOffset: {
      width: lengths[0],
      height: lengths[1],
    },
    textShadowRadius: lengths[2] ?? 0,
  };

  if (color !== undefined) {
    resolvedTextShadow.textShadowColor = color;
  }

  return resolvedTextShadow;
}

function parseTextDecoration(value, styleHelpers) {
  const tokens = splitStyleTokens(value);

  if (tokens.length === 0) {
    return null;
  }

  if (tokens.length === 1 && tokens[0].toLowerCase() === 'none') {
    return {
      textDecorationLine: 'none',
    };
  }

  const lineTokens = new Set();
  let styleToken;
  let colorToken;

  for (const token of tokens) {
    const normalizedToken = token.toLowerCase();

    if (TEXT_DECORATION_LINE_TOKENS.has(normalizedToken)) {
      lineTokens.add(normalizedToken);
      continue;
    }

    if (!styleToken && TEXT_DECORATION_STYLE_TOKENS.has(normalizedToken)) {
      styleToken = normalizedToken;
      continue;
    }

    if (!colorToken && isRecognizedColorToken(token, styleHelpers)) {
      colorToken = normalizeColorToken(token, styleHelpers);
      continue;
    }

    return null;
  }

  const resolvedTextDecoration = {};

  if (lineTokens.size > 0) {
    if (lineTokens.has('none')) {
      resolvedTextDecoration.textDecorationLine = 'none';
    } else {
      resolvedTextDecoration.textDecorationLine = ['underline', 'line-through']
        .filter(token => lineTokens.has(token))
        .join(' ');
    }
  }

  if (styleToken) {
    resolvedTextDecoration.textDecorationStyle = styleToken;
  }

  if (colorToken !== undefined) {
    resolvedTextDecoration.textDecorationColor = colorToken;
  }

  return Object.keys(resolvedTextDecoration).length > 0 ? resolvedTextDecoration : null;
}

export default {
  id: 'typography',
  order: 100,
  resolve(style, context) {
    if (!style || typeof style !== 'object' || Array.isArray(style)) {
      return style;
    }

    let resolvedStyle = null;
    const ensureResolvedStyle = () => {
      if (!resolvedStyle) {
        resolvedStyle = { ...style };
      }

      return resolvedStyle;
    };

    if ('letterSpacing' in style) {
      const letterSpacing = parseNumericStyleValue(style.letterSpacing);

      if (letterSpacing !== null && letterSpacing !== style.letterSpacing) {
        ensureResolvedStyle().letterSpacing = letterSpacing;
      }
    }

    if ('textShadowOffset' in style) {
      const nextTextShadowOffset = cloneTextShadowOffset(style.textShadowOffset);

      if (nextTextShadowOffset !== style.textShadowOffset) {
        ensureResolvedStyle().textShadowOffset = nextTextShadowOffset;
      }
    }

    if ('textShadow' in style) {
      const resolvedTextShadow = parseTextShadow(style.textShadow, context.styleHelpers);

      if (resolvedTextShadow) {
        const nextStyle = ensureResolvedStyle();
        delete nextStyle.textShadow;

        if (!('textShadowOffset' in style) && 'textShadowOffset' in resolvedTextShadow) {
          nextStyle.textShadowOffset = resolvedTextShadow.textShadowOffset;
        }

        if (!('textShadowRadius' in style) && 'textShadowRadius' in resolvedTextShadow) {
          nextStyle.textShadowRadius = resolvedTextShadow.textShadowRadius;
        }

        if (!('textShadowColor' in style) && 'textShadowColor' in resolvedTextShadow) {
          nextStyle.textShadowColor = resolvedTextShadow.textShadowColor;
        }
      }
    }

    if ('textDecoration' in style) {
      const resolvedTextDecoration = parseTextDecoration(style.textDecoration, context.styleHelpers);

      if (resolvedTextDecoration) {
        const nextStyle = ensureResolvedStyle();
        delete nextStyle.textDecoration;

        if (!('textDecorationLine' in style) && 'textDecorationLine' in resolvedTextDecoration) {
          nextStyle.textDecorationLine = resolvedTextDecoration.textDecorationLine;
        }

        if (!('textDecorationStyle' in style) && 'textDecorationStyle' in resolvedTextDecoration) {
          nextStyle.textDecorationStyle = resolvedTextDecoration.textDecorationStyle;
        }

        if (!('textDecorationColor' in style) && 'textDecorationColor' in resolvedTextDecoration) {
          nextStyle.textDecorationColor = resolvedTextDecoration.textDecorationColor;
        }
      }
    }

    return resolvedStyle ?? style;
  },
};
